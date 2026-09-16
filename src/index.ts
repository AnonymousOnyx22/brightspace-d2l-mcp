#!/usr/bin/env node
const CLI_COMMANDS = new Set(["setup", "login", "status", "logout", "uninstall", "serve", "config", "help", "--help", "-h", "--version", "-v"]);
const command = process.argv[2];

if (command && CLI_COMMANDS.has(command)) {
  const { runCli } = await import("./cli/main.js");
  process.exitCode = await runCli(command, process.argv.slice(3));
} else {
  const { startServer } = await import("./server.js");
  await startServer();
}
