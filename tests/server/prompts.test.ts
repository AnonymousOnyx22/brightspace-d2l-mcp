import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "../../src/prompts.js";

async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerPrompts(server);
  const client = new Client({ name: "client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("prompts", () => {
  it("lists the ready-made prompts", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(["what_should_i_do_now", "plan_my_week", "weekly_digest", "grade_target", "exam_prep", "summarize_assignment", "put_deadlines_in_my_calendar"]),
    );
  });

  it("points prompts at real tools and fills in arguments", async () => {
    const client = await connect();
    const result = await client.getPrompt({ name: "grade_target", arguments: { course: "Calculus", target: "85" } });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain("Calculus");
    expect(text).toContain("targetPercent 85");
    expect(text).toContain("get_grade_outlook");
  });
});
