#!/usr/bin/env node
const CLI_COMMANDS = new Set(["setup", "login", "status", "doctor", "logout", "uninstall", "serve", "config", "help", "--help", "-h", "--version", "-v"]);
const command = process.argv[2];

if (command && CLI_COMMANDS.has(command)) {
  const { runCli } = await import("./cli/main.js");
  const code = await runCli(command, process.argv.slice(3));
  // Exit as soon as a command finishes. A browser or timer left behind would otherwise keep the terminal busy.
  // `serve` only returns once its stdio server is running, so it keeps the process alive.
  if (command === "serve") process.exitCode = code;
  else process.stdout.write("", () => process.exit(code));
} else {
  const { startServer } = await import("./server.js");
  await startServer();
}
