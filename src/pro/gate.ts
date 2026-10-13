import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResponse } from "../tools/tool-helpers.js";
import { licenseIsActive } from "./license.js";

export const NO_LICENSE_MESSAGE =
  "Brightspace MCP needs an active subscription. Start a 7-day free trial at https://brightspacemcp.com/pro, " +
  "then run this in a terminal: npx brightspace-d2l-mcp activate <your key>";

/**
 * Wraps every tool registered on this server so it only runs with an active
 * license. Without one, the tool answers with how to subscribe instead.
 */
export function requireLicense(server: McpServer, isActive: () => Promise<boolean> = () => licenseIsActive()): McpServer {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name, config, handler) =>
    register(name, config, async (...args: unknown[]) =>
      (await isActive()) ? (handler as (...a: unknown[]) => unknown)(...args) : errorResponse(NO_LICENSE_MESSAGE),
    );
  return server;
}
