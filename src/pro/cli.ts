import * as ui from "../cli/ui.js";
import { loadConfig } from "../utils/config.js";
import { SETUP_COMMAND, PACKAGE_NAME } from "../utils/paths.js";
import { KEY_PATTERN, checkLicenseOnline, deleteLicense, readLicense, writeLicense } from "./license.js";
import { installAutostart, removeAutostart, runningAgentPid, startAgentNow, stopAgent } from "./autostart.js";
import { calendarFile, calendarUrl, runAgent } from "./agent.js";
import { notify } from "./notify.js";

const PRO_COMMAND = `npx -y ${PACKAGE_NAME}@latest pro`;
const ACTIVATE_COMMAND = `npx -y ${PACKAGE_NAME}@latest activate`;

function start(): void {
  const file = installAutostart();
  startAgentNow();
  ui.ok("Pro alerts are running, and will start by themselves when you log in.");
  if (file) ui.info(ui.dim(`Startup entry: ${file}`));
}

function printCalendarHelp(): void {
  console.log(`\n  ${ui.bold("Calendar sync")}`);
  ui.info(`Subscribe to ${ui.cyan(calendarUrl())} in Apple Calendar or Outlook (desktop).`);
  ui.info(ui.dim(`It stays up to date while your computer is on. The file is also saved at ${calendarFile()}`));
}

/** Checks a key online and saves it. Prints why when it fails. */
export async function activateKey(key: string | undefined): Promise<boolean> {
  key = key?.trim();
  if (!key || !KEY_PATTERN.test(key)) {
    ui.fail(`That doesn't look like a key. It starts with ${ui.bold("bmp_")}. Copy it from the page you saw after starting your trial.`);
    return false;
  }
  ui.info("Checking your key...");
  let result;
  try {
    result = await checkLicenseOnline(key);
  } catch (error) {
    ui.fail(`Couldn't reach brightspacemcp.com. Check your internet and try again. ${ui.dim(String(error instanceof Error ? error.message : error))}`);
    return false;
  }
  if (!result.active) {
    ui.fail(result.status === "invalid" ? "That key isn't valid." : `That subscription isn't active (${result.status}). Renew at brightspacemcp.com/pro`);
    return false;
  }
  const now = Date.now();
  writeLicense({ key, ...result, checkedAt: now, lastActiveAt: now });
  ui.ok(result.status === "trialing" ? "Free trial active." : "Subscription active.");
  return true;
}

/** Turns on alerts after setup or activation. */
export async function startAlerts(): Promise<void> {
  start();
  await notify({ title: "Brightspace MCP is on", body: "You'll get deadline, grade and daily alerts here." });
  printCalendarHelp();
}

async function activate(key: string | undefined): Promise<number> {
  if (!(await activateKey(key))) return 1;
  if (!loadConfig().baseUrl) {
    ui.info(`Next, connect your school and AI apps: ${ui.cyan(SETUP_COMMAND)}`);
    return 0;
  }
  await startAlerts();
  console.log();
  return 0;
}

function status(): number {
  const license = readLicense();
  console.log(`\n${ui.bold("Brightspace MCP subscription")}`);
  if (!license) {
    ui.warn(`Not activated. Start a free trial at brightspacemcp.com/pro, then run: ${ACTIVATE_COMMAND} <key>`);
    return 1;
  }
  if (license.active) ui.ok(`License: active${license.periodEnd ? ui.dim(` (renews ${new Date(license.periodEnd * 1000).toLocaleDateString()})`) : ""}`);
  else ui.warn(`License: ${license.status}`);
  const pid = runningAgentPid();
  if (pid) ui.ok("Alerts: running");
  else ui.warn(`Alerts: not running. Start them with: ${PRO_COMMAND} start`);
  printCalendarHelp();
  console.log();
  return 0;
}

export async function runPro(args: string[]): Promise<number> {
  const [sub, value] = args;
  switch (sub) {
    case "activate":
      return activate(value);
    case "status":
      return status();
    case "start":
      if (!readLicense()) {
        ui.fail(`Activate first: ${ACTIVATE_COMMAND} <key>`);
        return 1;
      }
      start();
      return 0;
    case "stop":
      removeAutostart();
      ui.ok(stopAgent() ? "Pro alerts stopped and won't start at login." : "Pro alerts won't start at login.");
      return 0;
    case "deactivate":
      removeAutostart();
      stopAgent();
      deleteLicense();
      ui.ok("Your key was removed from this computer. Manage or cancel your subscription at brightspacemcp.com/pro.");
      return 0;
    case "test":
      await notify({ title: "Test from Brightspace MCP", body: "If you can read this, notifications work." });
      ui.ok("Sent a test notification.");
      return 0;
    case "agent":
      return runAgent();
    default:
      console.log(`
${ui.bold("Brightspace MCP alerts")}  Deadline alerts, a daily digest, grade alerts and calendar sync

  ${ui.cyan("activate <key>")}      Turn on your subscription with the key from brightspacemcp.com/pro
  ${ui.cyan("pro status")}          Show your subscription, alerts and calendar link
  ${ui.cyan("pro start")}           Start alerts (also at every login)
  ${ui.cyan("pro stop")}            Stop alerts
  ${ui.cyan("pro test")}            Send a test notification
  ${ui.cyan("deactivate")}          Remove your key from this computer
`);
      return 0;
  }
}
