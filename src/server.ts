import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { enableStdoutGuard, log } from "./utils/logger.js";
import { loadConfig, readStoredConfig, writeStoredConfig } from "./utils/config.js";
import { packageVersion } from "./utils/version.js";
import { TokenManager, Authenticator, AuthRequiredError } from "./auth/index.js";
import { SETUP_COMMAND } from "./utils/paths.js";
import { D2LApiClient } from "./api/index.js";
import type { AppConfig } from "./types/index.js";
import {
  registerGetMyCourses,
  registerGetUpcomingDueDates,
  registerGetMyGrades,
  registerGetAnnouncements,
  registerGetAssignments,
  registerGetAssignmentFiles,
  registerGetCourseContent,
  registerDownloadFile,
  registerGetClasslistEmails,
  registerGetRoster,
  registerGetSyllabus,
  registerGetDiscussions,
  registerGetTodo,
} from "./tools/index.js";

function notConfiguredClient(client: D2LApiClient): D2LApiClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "get" || property === "getRaw") {
        return async () => {
          throw new AuthRequiredError("notConfigured", `Brightspace is not set up yet. Run \`${SETUP_COMMAND}\` in a terminal.`);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

interface Backend {
  config: AppConfig;
  apiClient: D2LApiClient;
  /** The MCP servers currently connected, so sign-in progress reaches whoever is asking. */
  servers: Set<McpServer>;
}

// One API client and session for the whole process, shared by every connection.
function createBackend(): Backend {
  const config = loadConfig();
  if (!config.baseUrl) log("WARN", "No school configured yet; tools will explain how to run setup");

  const servers = new Set<McpServer>();
  const tokenManager = new TokenManager({ baseUrl: config.baseUrl || undefined, tokenTtl: config.tokenTtl });
  const authenticator = new Authenticator({
    baseUrl: config.baseUrl,
    tokenTtl: config.tokenTtl,
    autoLogin: config.autoLogin,
    tokenManager,
    notify: (message) => {
      log("INFO", message);
      for (const server of servers) {
        void server.sendLoggingMessage({ level: "info", logger: "brightspace-auth", data: message }).catch(() => {});
      }
    },
  });

  // Sign-in waits for the first tool call, so starting an AI app never opens a browser by itself.
  const client = new D2LApiClient({
    baseUrl: config.baseUrl || "https://not-configured.invalid",
    tokenManager,
    onAuthExpired: () => authenticator.run(),
  });
  return { config, apiClient: config.baseUrl ? client : notConfiguredClient(client), servers };
}

function createMcpServer({ config, apiClient }: Backend): McpServer {
  const server = new McpServer(
    {
      name: "brightspace",
      version: packageVersion(),
      description: "D2L Brightspace for students: what to do next, due dates with submission status, grades, content, announcements.",
    },
    { capabilities: { logging: {} } },
  );

  registerGetTodo(server, apiClient, config);
  registerGetMyCourses(server, apiClient, config);
  registerGetUpcomingDueDates(server, apiClient, config);
  registerGetMyGrades(server, apiClient, config);
  registerGetAnnouncements(server, apiClient, config);
  registerGetAssignments(server, apiClient, config);
  registerGetAssignmentFiles(server, apiClient, config.baseUrl);
  registerGetCourseContent(server, apiClient);
  registerDownloadFile(server, apiClient);
  registerGetClasslistEmails(server, apiClient);
  registerGetRoster(server, apiClient);
  registerGetSyllabus(server, apiClient);
  registerGetDiscussions(server, apiClient);
  return server;
}

export async function startServer(): Promise<void> {
  // stdout carries the MCP protocol; anything else printed there corrupts it.
  enableStdoutGuard();
  process.on("unhandledRejection", (reason) => log("ERROR", "Unhandled promise rejection", reason));

  try {
    const backend = createBackend();
    const server = createMcpServer(backend);
    backend.servers.add(server);
    await server.connect(new StdioServerTransport());
    log("INFO", `brightspace-d2l-mcp v${packageVersion()} running for ${backend.config.baseUrl || "(not set up)"}`);
  } catch (error) {
    log("ERROR", "MCP server failed to start", error);
    process.exit(1);
  }

  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export interface HttpOptions {
  port: number;
  host: string;
  /** Skip the access token. Only allowed on localhost. */
  noAuth: boolean;
}

export function httpAccessToken(): string {
  const stored = readStoredConfig().httpToken;
  if (stored) return stored;
  const token = randomBytes(24).toString("base64url");
  writeStoredConfig({ httpToken: token });
  return token;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Streamable HTTP transport for clients that can't launch a local process:
 * ChatGPT connectors (through a tunnel), hosted agents and HTTP-only frameworks.
 * The token is accepted as a Bearer header or as the last path segment (/mcp/<token>),
 * since some apps only let you paste a URL.
 */
export async function startHttpServer(options: HttpOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(options.host);
  if (options.noAuth && !isLocal) throw new Error("--no-auth is only allowed when listening on localhost.");

  const backend = createBackend();
  const token = options.noAuth ? null : httpAccessToken();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const [, first, pathToken] = url.pathname.split("/");

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version: packageVersion() }));
      return;
    }
    if (first !== "mcp") {
      res.writeHead(404).end();
      return;
    }
    if (token) {
      const header = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!tokenMatches(header, token) && !tokenMatches(pathToken, token)) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" })
          .end(JSON.stringify({ error: "Missing or wrong access token." }));
        return;
      }
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }

    // Stateless: a fresh MCP server per request, sharing the one signed-in backend.
    const server = createMcpServer(backend);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    backend.servers.add(server);
    res.on("close", () => {
      backend.servers.delete(server);
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      log("ERROR", "HTTP request failed", error);
      if (!res.headersSent) res.writeHead(500).end();
    }
  };

  const httpServer = createHttpServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, resolve);
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const displayHost = options.host.includes(":") ? `[${options.host}]` : options.host;
  return {
    url: `http://${displayHost}:${port}/mcp${token ? `/${token}` : ""}`,
    close: () => new Promise((resolve) => httpServer.close(() => resolve())),
  };
}
