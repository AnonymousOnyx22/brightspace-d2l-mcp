import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToClient, isConfiguredIn, removeFromClient, type ClientTarget } from "../../src/cli/clients.js";

let dir: string;
const entry = { command: "npx", args: ["-y", "brightspace-d2l-mcp@latest"] };

function target(file: string, overrides: Partial<ClientTarget> = {}): ClientTarget {
  return { id: "test", name: "Test", files: [path.join(dir, file)], format: "json", keyPath: ["mcpServers"], ...overrides };
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bsm-clients-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("JSON client configs", () => {
  it("adds the server while keeping everything else in the file", () => {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, JSON.stringify({ preferences: { theme: "dark" }, mcpServers: { other: { command: "x" } } }));
    const client = target("config.json");

    addToClient(client, entry);

    const saved = readJson(file);
    expect(saved.preferences).toEqual({ theme: "dark" });
    expect(saved.mcpServers.other).toEqual({ command: "x" });
    expect(saved.mcpServers.brightspace).toEqual(entry);
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(isConfiguredIn(client)).toBe(true);
  });

  it("creates missing files and applies each app's own shape", () => {
    const vscode = target("vscode/mcp.json", { keyPath: ["servers"], shape: (e) => ({ type: "stdio", ...e }) });
    addToClient(vscode, entry);
    expect(readJson(vscode.files[0]).servers.brightspace).toEqual({ type: "stdio", ...entry });

    const opencode = target("opencode.json", { keyPath: ["mcp"], shape: (e) => ({ type: "local", command: [e.command, ...e.args], enabled: true }) });
    addToClient(opencode, entry);
    expect(readJson(opencode.files[0]).mcp.brightspace.command).toEqual(["npx", "-y", "brightspace-d2l-mcp@latest"]);
  });

  it("replaces an older entry and removes only its own", () => {
    const client = target("config.json");
    addToClient(client, { command: "old", args: [] });
    addToClient(client, entry);
    expect(readJson(client.files[0]).mcpServers.brightspace).toEqual(entry);

    expect(removeFromClient(client)).toBe(true);
    expect(isConfiguredIn(client)).toBe(false);
    expect(removeFromClient(client)).toBe(false);
  });

  it("refuses to rewrite a file with comments", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{ // my settings\n}");
    expect(() => addToClient(target("settings.json"), entry)).toThrow(/comments/);
    expect(fs.readFileSync(file, "utf8")).toContain("my settings");
  });
});

describe("TOML client configs (Codex)", () => {
  it("adds, replaces and removes its table without touching others", () => {
    const file = path.join(dir, "config.toml");
    fs.writeFileSync(file, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
    const codex = target("config.toml", { format: "toml", keyPath: ["mcp_servers"] });

    addToClient(codex, { command: "old", args: [] });
    addToClient(codex, entry);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain("[mcp_servers.other]");
    expect(text.match(/\[mcp_servers\.brightspace\]/g)).toHaveLength(1);
    expect(text).toContain('args = ["-y", "brightspace-d2l-mcp@latest"]');
    expect(isConfiguredIn(codex)).toBe(true);

    expect(removeFromClient(codex)).toBe(true);
    const after = fs.readFileSync(file, "utf8");
    expect(after).not.toContain("brightspace");
    expect(after).toContain("[mcp_servers.other]");
  });
});
