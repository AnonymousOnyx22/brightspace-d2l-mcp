#!/usr/bin/env node
const CLI_COMMANDS = new Set(["setup", "login", "status", "doctor", "logout", "uninstall", "serve", "config", "help", "--help", "-h", "--version", "-v"]);
// AI apps launch the server with piped stdio. A person typing the bare command in a terminal gets help instead of a silent server.
const command = process.argv[2] ?? (process.stdin.isTTY ? "help" : undefined);

if (command && CLI_COMMANDS.has(command)) {
  const { runCli } = await import("./cli/main.js");
  const { offerUpdate } = await import("./cli/update-check.js");
  const args = process.argv.slice(3);
  const code = (await offerUpdate(command, args)) ?? (await runCli(command, args));
  // Exit as soon as a command finishes. A browser or timer left behind would otherwise keep the terminal busy.
  // `serve` only returns once its stdio server is running, so it keeps the process alive.
  if (command === "serve") process.exitCode = code;
  else process.stdout.write("", () => process.exit(code));
} else {
  const { startServer } = await import("./server.js");
  await startServer();
}
