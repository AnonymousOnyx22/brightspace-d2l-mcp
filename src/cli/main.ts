import * as fs from "node:fs";
import { loadConfig } from "../utils/config.js";
import { browserProfileDir, dataDir, LOGIN_COMMAND, savedCookiesPath, SETUP_COMMAND } from "../utils/paths.js";
import { packageVersion } from "../utils/version.js";
import { loginWithBrowser, LoginError, SessionStore, TokenManager } from "../auth/index.js";
import { APP_IDS, detectClients, isConfiguredIn, removeFromClient, serverEntry } from "./clients.js";
import { runSetup, printManualConfig } from "./setup.js";
import * as ui from "./ui.js";

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

export async function runCli(command: string, args: string[]): Promise<number> {
  switch (command) {
    case "setup":
      return runSetup({
        school: flagValue(args, "--school"),
        yes: args.includes("--yes") || args.includes("-y"),
        skipLogin: args.includes("--skip-login"),
        apps: flagValue(args, "--apps")?.split(",").map((s) => s.trim()),
      });
    case "login":
      return login();
    case "status":
      return status();
    case "logout":
      await new SessionStore().clear();
      fs.rmSync(browserProfileDir(), { recursive: true, force: true });
      fs.rmSync(savedCookiesPath(), { force: true });
      ui.ok("Signed out. The saved session and browser profile were deleted.");
      return 0;
    case "uninstall":
      return uninstall(args.includes("--yes") || args.includes("-y"));
    case "serve":
      return serve(args);
    case "config":
      console.log(JSON.stringify({ mcpServers: { brightspace: serverEntry() } }, null, 2));
      return 0;
    case "--version":
    case "-v":
      console.log(packageVersion());
      return 0;
    default:
      printHelp();
      return 0;
  }
}

async function login(): Promise<number> {
  const config = loadConfig();
  if (!config.baseUrl) {
    ui.fail(`No school set up yet. Run: ${SETUP_COMMAND}`);
    return 1;
  }
  ui.info(`Opening ${ui.bold(config.baseUrl)} in a browser window. Sign in there.`);
  try {
    const { token, displayName } = await loginWithBrowser({
      baseUrl: config.baseUrl,
      mode: "interactive",
      tokenTtlSeconds: config.tokenTtl,
      onStatus: (m) => ui.info(ui.dim(m)),
    });
    await new TokenManager({ baseUrl: config.baseUrl }).setToken(token);
    ui.ok(displayName ? `Signed in as ${ui.bold(displayName)}` : "Signed in");
    return 0;
  } catch (error) {
    ui.fail(error instanceof Error ? error.message : String(error));
    return error instanceof LoginError && error.kind === "cancelled" ? 2 : 1;
  }
}

async function status(): Promise<number> {
  const config = loadConfig();
  console.log(`\n${ui.bold("brightspace-d2l-mcp")} ${ui.dim(`v${packageVersion()}`)}`);
  if (!config.baseUrl) {
    ui.fail(`Not set up. Run: ${SETUP_COMMAND}`);
    return 1;
  }
  ui.ok(`School: ${config.baseUrl}`);

  const tokenManager = new TokenManager({ baseUrl: config.baseUrl, tokenTtl: config.tokenTtl });
  try {
    const token = await tokenManager.getToken();
    if (token) ui.ok("Session: signed in");
    else ui.warn(`Session: expired. It will reopen sign-in when needed, or run: ${LOGIN_COMMAND}`);
  } catch {
    ui.warn("Session: couldn't check right now (network).");
  }

  const clients = detectClients();
  if (!clients.length) ui.warn("No supported AI apps found.");
  for (const client of clients) {
    if (isConfiguredIn(client)) ui.ok(`${client.name}: connected`);
    else ui.info(`${ui.dim("-")} ${client.name}: not connected ${ui.dim(`(run ${SETUP_COMMAND})`)}`);
  }
  console.log();
  return 0;
}

async function serve(args: string[]): Promise<number> {
  const { startServer, startHttpServer } = await import("../server.js");
  if (!args.includes("--http")) {
    await startServer();
    return 0;
  }

  const port = Number(flagValue(args, "--port") ?? process.env.PORT ?? 8787);
  const host = flagValue(args, "--host") ?? "127.0.0.1";
  const noAuth = args.includes("--no-auth");
  try {
    const { url } = await startHttpServer({ port, host, noAuth });
    console.log(`\n${ui.bold("Brightspace MCP server")} ${ui.dim("(streamable HTTP)")}`);
    ui.ok(`Listening: ${ui.cyan(url)}`);
    if (!noAuth) {
      ui.info(ui.dim("The last part of that URL is your access token. Keep it private."));
      ui.info(ui.dim("Clients that support headers can use /mcp with  Authorization: Bearer <token>."));
    }
    ui.info(ui.dim("Press Ctrl+C to stop."));
    await new Promise(() => {});
    return 0;
  } catch (error) {
    ui.fail(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function uninstall(yes: boolean): Promise<number> {
  if (yes) ui.setNonInteractive();
  if (!(await ui.confirm("Remove Brightspace from your AI apps and delete its saved data?", false)) && !yes) return 0;
  for (const client of detectClients()) {
    if (removeFromClient(client)) ui.ok(`Removed from ${client.name}`);
  }
  fs.rmSync(dataDir(), { recursive: true, force: true });
  ui.ok(`Deleted ${dataDir()}`);
  return 0;
}

function printHelp(): void {
  console.log(`
${ui.bold("brightspace-d2l-mcp")} ${ui.dim(`v${packageVersion()}`)}  Brightspace (D2L) for Claude, Cursor and other AI apps

  ${ui.cyan("setup")}       Pick your school, sign in, and connect your AI apps
  ${ui.cyan("login")}       Sign in again
  ${ui.cyan("status")}      Show your school, session and connected apps
  ${ui.cyan("logout")}      Delete the saved session
  ${ui.cyan("uninstall")}   Remove from AI apps and delete all local data
  ${ui.cyan("serve")}       Run the MCP server over stdio (what AI apps launch)
  ${ui.cyan("serve --http")} Run over HTTP for ChatGPT and HTTP agents  [--port 8787] [--host 127.0.0.1] [--no-auth]
  ${ui.cyan("config")}      Print the MCP config JSON for any other app

  Setup options: --school <address>  --yes  --skip-login  --apps ${APP_IDS.join(",")}
`);
  printManualConfig();
  console.log();
}
