import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NO_LICENSE_MESSAGE, requireLicense } from "../../src/pro/gate.js";

async function callWith(active: boolean) {
  const server = requireLicense(new McpServer({ name: "t", version: "0" }), async () => active);
  server.registerTool("get_thing", { description: "x" }, async () => ({ content: [{ type: "text" as const, text: "real data" }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "c", version: "0" });
  await client.connect(b);
  const tools = await client.listTools();
  const result = await client.callTool({ name: "get_thing", arguments: {} });
  await client.close();
  return { tools: tools.tools.map((t) => t.name), result };
}

describe("license gate", () => {
  it("runs tools with an active license", async () => {
    const { tools, result } = await callWith(true);
    expect(tools).toEqual(["get_thing"]);
    expect(result.content).toEqual([{ type: "text", text: "real data" }]);
  });

  it("explains how to subscribe without one, but still lists the tools", async () => {
    const { tools, result } = await callWith(false);
    expect(tools).toEqual(["get_thing"]);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: NO_LICENSE_MESSAGE }]);
  });
});
