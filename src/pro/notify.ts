import { execFile } from "node:child_process";
import { log } from "../utils/logger.js";
import type { Notice } from "./checks.js";

// Desktop notifications with what each OS already has. Text is always passed
// as an argument or environment variable, never pasted into a script.

const WINDOWS_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const WINDOWS_SCRIPT = [
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$n = $t.GetElementsByTagName('text')",
  "$n.Item(0).AppendChild($t.CreateTextNode($env:BMCP_TITLE)) > $null",
  "$n.Item(1).AppendChild($t.CreateTextNode($env:BMCP_BODY)) > $null",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:BMCP_APP).Show([Windows.UI.Notifications.ToastNotification]::new($t))",
].join("; ");

export interface NotifyCommand {
  file: string;
  args: string[];
  env?: Record<string, string>;
}

export function notifyCommand(notice: Notice, platform: NodeJS.Platform = process.platform): NotifyCommand | null {
  const title = notice.title.slice(0, 120);
  const body = notice.body.slice(0, 300);
  if (platform === "win32") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS_SCRIPT],
      env: { BMCP_TITLE: title, BMCP_BODY: body, BMCP_APP: WINDOWS_APP_ID },
    };
  }
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body],
    };
  }
  if (platform === "linux") return { file: "notify-send", args: ["--app-name=Brightspace MCP", title, body] };
  return null;
}

export function notify(notice: Notice): Promise<void> {
  const command = notifyCommand(notice);
  if (!command) return Promise.resolve();
  return new Promise((resolve) => {
    execFile(command.file, command.args, { env: { ...process.env, ...command.env }, timeout: 15_000, windowsHide: true }, (error) => {
      if (error) log("WARN", `Couldn't show a notification: ${error.message}`);
      resolve();
    });
  });
}
