# Using Brightspace with any AI app or agent

`brightspace-d2l-mcp` is a standard [Model Context Protocol](https://modelcontextprotocol.io) server, so it works with any MCP client or agent framework. It runs two ways:

| Mode | Command | Use it for |
|---|---|---|
| **stdio** (default) | `npx -y brightspace-d2l-mcp@latest` | Desktop apps, coding agents, CLIs and SDKs that start the server themselves |
| **HTTP** | `npx brightspace-d2l-mcp serve --http` | ChatGPT, web-based agents, and frameworks that connect to a URL |

Whichever you use, run setup once to choose your school and sign in:

```bash
npx brightspace-d2l-mcp setup
```

**Contents**

- [Apps setup connects for you](#apps-setup-connects-for-you)
- [ChatGPT](#chatgpt)
- [Other apps](#other-apps): Continue, Goose, JetBrains AI Assistant, Warp, Amp, Msty and more
- [Agent frameworks](#agent-frameworks): OpenAI Agents SDK, Claude Agent SDK, LangChain / LangGraph, Vercel AI SDK, Mastra, CrewAI, Pydantic AI, LlamaIndex
- [HTTP mode reference](#http-mode-reference)
- [Tools](#tools)

---

## Apps setup connects for you

`setup` finds these on your computer and adds Brightspace to them:

| App | Config it edits |
|---|---|
| Claude Desktop | `claude_desktop_config.json` (including the Microsoft Store version) |
| Claude Code | `~/.claude.json` via `claude mcp add` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code (GitHub Copilot) | `Code/User/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| OpenAI Codex (CLI and IDE) | `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cline | Cline's `cline_mcp_settings.json` |
| Roo Code | Roo's `mcp_settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| Zed | `settings.json` → `context_servers` |
| LM Studio | `~/.lmstudio/mcp.json` |
| Kiro | `~/.kiro/settings/mcp.json` |

To connect only some of them: `npx brightspace-d2l-mcp setup --apps cursor,codex`

---

## ChatGPT

ChatGPT connects to MCP servers over the internet, not on your computer, so it needs HTTP mode plus a tunnel.

1. Start the server:

   ```bash
   npx brightspace-d2l-mcp serve --http
   ```

   It prints a private URL like `http://127.0.0.1:8787/mcp/<token>`.

2. Make it reachable with a tunnel, for example [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8787
   ```

   Your URL becomes `https://<random>.trycloudflare.com/mcp/<token>`.

3. In ChatGPT, open **Settings → Apps & Connectors → Advanced**, turn on **Developer mode**, then **Create** a connector with that URL and **No authentication**. The token in the URL is what protects it.

> **Keep the URL private.** Anyone with it can read your Brightspace while the server and tunnel are running. Stop both with Ctrl+C when you're done.

---

## Other apps

Most apps take the same JSON. Print it with `npx brightspace-d2l-mcp config`.

**macOS / Linux**

```json
{
  "mcpServers": {
    "brightspace": { "command": "npx", "args": ["-y", "brightspace-d2l-mcp@latest"] }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "brightspace": { "command": "cmd", "args": ["/c", "npx", "-y", "brightspace-d2l-mcp@latest"] }
  }
}
```

<details>
<summary><b>Continue</b> (<code>~/.continue/config.yaml</code>)</summary>

```yaml
mcpServers:
  - name: brightspace
    command: npx
    args: ["-y", "brightspace-d2l-mcp@latest"]
```
</details>

<details>
<summary><b>Goose</b></summary>

```bash
goose configure
```

Choose **Add Extension → Command-line Extension**, name it `brightspace`, and use the command `npx -y brightspace-d2l-mcp@latest`.
</details>

<details>
<summary><b>JetBrains AI Assistant</b> (IntelliJ, PyCharm, WebStorm…)</summary>

**Settings → Tools → AI Assistant → Model Context Protocol (MCP) → Add**, then paste the JSON above.
</details>

<details>
<summary><b>Warp</b></summary>

**Settings → AI → MCP servers → Add**, then paste the JSON above.
</details>

<details>
<summary><b>Amp</b></summary>

In your Amp settings (`amp.mcpServers`):

```json
"amp.mcpServers": {
  "brightspace": { "command": "npx", "args": ["-y", "brightspace-d2l-mcp@latest"] }
}
```
</details>

<details>
<summary><b>Msty, Jan, AnythingLLM, BoltAI, 5ire and other MCP apps</b></summary>

Add a stdio MCP server with command `npx` and arguments `-y brightspace-d2l-mcp@latest` (on Windows: command `cmd`, arguments `/c npx -y brightspace-d2l-mcp@latest`).
</details>

---

## Agent frameworks

<details open>
<summary><b>OpenAI Agents SDK</b> (Python)</summary>

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

async with MCPServerStdio(command="npx", args=["-y", "brightspace-d2l-mcp@latest"]) as brightspace:
    agent = Agent(
        name="Study planner",
        instructions="Help the student plan their week using Brightspace.",
        mcp_servers=[brightspace],
    )
    result = await Runner.run(agent, "What should I work on right now?")
    print(result.final_output)
```
</details>

<details>
<summary><b>Claude Agent SDK</b> (TypeScript)</summary>

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "What should I work on right now?",
  options: {
    mcpServers: {
      brightspace: { command: "npx", args: ["-y", "brightspace-d2l-mcp@latest"] },
    },
    allowedTools: ["mcp__brightspace"],
  },
})) {
  if (message.type === "result" && message.subtype === "success") console.log(message.result);
}
```
</details>

<details>
<summary><b>Claude Agent SDK</b> (Python)</summary>

```python
from claude_agent_sdk import query, ClaudeAgentOptions

options = ClaudeAgentOptions(
    mcp_servers={"brightspace": {"command": "npx", "args": ["-y", "brightspace-d2l-mcp@latest"]}},
    allowed_tools=["mcp__brightspace"],
)
async for message in query(prompt="What's due this week?", options=options):
    print(message)
```
</details>

<details>
<summary><b>LangChain / LangGraph</b> (Python)</summary>

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

client = MultiServerMCPClient({
    "brightspace": {"command": "npx", "args": ["-y", "brightspace-d2l-mcp@latest"], "transport": "stdio"},
})
tools = await client.get_tools()
agent = create_react_agent("openai:gpt-5", tools)
result = await agent.ainvoke({"messages": [{"role": "user", "content": "What's due this week?"}]})
```
</details>

<details>
<summary><b>Vercel AI SDK</b> (TypeScript)</summary>

```ts
import { experimental_createMCPClient as createMCPClient, generateText } from "ai";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "ai/mcp-stdio";

const brightspace = await createMCPClient({
  transport: new StdioMCPTransport({ command: "npx", args: ["-y", "brightspace-d2l-mcp@latest"] }),
});
const { text } = await generateText({
  model: "openai/gpt-5",
  tools: await brightspace.tools(),
  prompt: "What should I work on right now?",
});
await brightspace.close();
```
</details>

<details>
<summary><b>Mastra</b> (TypeScript)</summary>

```ts
import { MCPClient } from "@mastra/mcp";

const mcp = new MCPClient({
  servers: { brightspace: { command: "npx", args: ["-y", "brightspace-d2l-mcp@latest"] } },
});
const tools = await mcp.getTools();
```
</details>

<details>
<summary><b>CrewAI</b> (Python)</summary>

```python
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

params = StdioServerParameters(command="npx", args=["-y", "brightspace-d2l-mcp@latest"])
with MCPServerAdapter(params) as tools:
    ...  # pass `tools` to your Agent
```
</details>

<details>
<summary><b>Pydantic AI</b> (Python)</summary>

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

brightspace = MCPServerStdio("npx", args=["-y", "brightspace-d2l-mcp@latest"])
agent = Agent("openai:gpt-5", toolsets=[brightspace])

async with agent:
    result = await agent.run("What's due this week?")
```
</details>

<details>
<summary><b>LlamaIndex</b> (Python)</summary>

```python
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec

client = BasicMCPClient("npx", args=["-y", "brightspace-d2l-mcp@latest"])
tools = await McpToolSpec(client=client).to_tool_list_async()
```
</details>

<details>
<summary><b>Anything that speaks HTTP MCP</b></summary>

Start `npx brightspace-d2l-mcp serve --http` and point your client at the printed URL, or at `http://127.0.0.1:8787/mcp` with the header `Authorization: Bearer <token>`.
</details>

---

## HTTP mode reference

```bash
npx brightspace-d2l-mcp serve --http [--port 8787] [--host 127.0.0.1] [--no-auth]
```

| Option | Default | Notes |
|---|---|---|
| `--port` | `8787` (or `$PORT`) | |
| `--host` | `127.0.0.1` | Only this computer can connect. Use a tunnel rather than `0.0.0.0`. |
| `--no-auth` | off | Skip the access token. Only allowed on localhost. |

- The access token is created once and stored in `~/.brightspace-d2l-mcp/config.json` as `httpToken`. Delete that line to get a new one.
- It uses the streamable HTTP transport in stateless JSON mode at `/mcp`, and `GET /health` returns `{"ok": true}`.
- If your session expires while it's running, a sign-in window opens on the computer running the server.

---

## Tools

| Tool | What it returns |
|---|---|
| `get_todo` | Prioritized list: do now, overdue, not open yet, check yourself, already done |
| `get_upcoming_due_dates` | Due dates across courses, each with submission status |
| `get_assignments` | Assignments and quizzes with instructions, rubrics, submission status and feedback |
| `get_my_grades` | Grades for one course or all courses |
| `get_my_courses` | Enrolled courses |
| `get_announcements` | Recent announcements |
| `get_course_content` | Modules and topics |
| `get_assignment_files` | Text of files attached to an assignment (PDF, Word, Excel, PowerPoint) |
| `download_file` | Save a course or submission file to disk |
| `get_syllabus` | The course syllabus |
| `get_discussions` | Discussion forums and posts |
| `get_roster` | Class list |
| `get_classlist_emails` | Emails of classmates and instructors |

Every tool is read-only.
