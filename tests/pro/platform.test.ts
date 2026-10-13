import { describe, expect, it } from "vitest";
import { notifyCommand } from "../../src/pro/notify.js";
import { autostartEntry, npxPath } from "../../src/pro/autostart.js";
import { KEY_PATTERN } from "../../src/pro/license.js";

const notice = { title: `Due "soon"; $(rm -rf ~)`, body: "COMP 101 `x`" };

describe("notifications", () => {
  it("never puts notice text inside a script", () => {
    const win = notifyCommand(notice, "win32")!;
    expect(win.args.join(" ")).not.toContain("rm -rf");
    expect(win.env?.BMCP_TITLE).toBe(notice.title);

    const mac = notifyCommand(notice, "darwin")!;
    expect(mac.args.slice(0, 6).join(" ")).not.toContain("rm -rf");
    expect(mac.args.slice(-2)).toEqual([notice.title, notice.body]);

    expect(notifyCommand(notice, "linux")!.args.slice(-2)).toEqual([notice.title, notice.body]);
    expect(notifyCommand(notice, "aix")).toBeNull();
  });
});

describe("autostart", () => {
  it("runs the latest version through npx next to node", () => {
    expect(npxPath("darwin", "/usr/local/bin/node")).toBe("/usr/local/bin/npx");
    const mac = autostartEntry("darwin", "/Users/s", "/usr/local/bin/node")!;
    expect(mac.file).toBe("/Users/s/Library/LaunchAgents/com.brightspacemcp.pro.plist");
    expect(mac.contents).toContain("<string>brightspace-d2l-mcp@latest</string>");
    expect(mac.contents).toContain("<key>RunAtLoad</key><true/>");

    const linux = autostartEntry("linux", "/home/s", "/opt/node bin/node")!;
    expect(linux.contents).toContain('Exec="/opt/node bin/npx" -y brightspace-d2l-mcp@latest pro agent');

    const win = autostartEntry("win32", "C:\\Users\\s", "C:\\Program Files\\nodejs\\node.exe")!;
    expect(win.file).toMatch(/Startup[\\/]Brightspace MCP Pro\.vbs$/);
    expect(win.contents).toContain('""C:\\Program Files\\nodejs\\npx.cmd"" -y brightspace-d2l-mcp@latest pro agent", 0, False');
  });
});

it("recognizes Pro keys", () => {
  expect(KEY_PATTERN.test("bmp_sub1AbC_abcdefghijklmnop")).toBe(true);
  expect(KEY_PATTERN.test("sk_live_123")).toBe(false);
});
