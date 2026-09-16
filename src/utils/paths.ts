import * as os from "node:os";
import * as path from "node:path";

export const PACKAGE_NAME = "brightspace-d2l-mcp";

export const SERVER_NAME = "brightspace";

export const SETUP_COMMAND = `npx -y ${PACKAGE_NAME}@latest setup`;
export const LOGIN_COMMAND = `npx -y ${PACKAGE_NAME}@latest login`;

export function dataDir(): string {
  return process.env.BRIGHTSPACE_MCP_HOME || path.join(os.homedir(), ".brightspace-d2l-mcp");
}

export const configPath = (): string => path.join(dataDir(), "config.json");
export const sessionPath = (): string => path.join(dataDir(), "session.json");
export const browserProfileDir = (): string => path.join(dataDir(), "browser-profile");
export const savedCookiesPath = (): string => path.join(dataDir(), "browser-cookies.json");
export const loginLockPath = (): string => path.join(dataDir(), "login.lock");
