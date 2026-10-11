# Security

This server is read-only and runs on your own computer. It never stores your password. Your school's own sign-in page handles it in a real browser, and only a session token is saved in `~/.brightspace-d2l-mcp/`.

## Reporting a problem

If you find a security issue, please do not open a public issue. Use GitHub's private reporting instead under the Security tab, then "Report a vulnerability". You should get a reply within a few days.

## How read-only is enforced

- **In the code.** The API client only exposes GET requests. There are no POST, PUT or DELETE methods to call, and the tools only call that client. A test in `tests/tools/read-only.test.ts` fails the build if a write method or a non-GET request is added.
- **In the tool list.** Every `get_` tool is marked `readOnlyHint: true`, so AI apps can tell it doesn't change anything. `download_file` and the calendar export only write files to your own computer.
- **What this does not do.** After you sign in, the session token is the same as the one your browser gets, and Brightspace does not give students a read-only token. So the guarantee comes from this server's code and what it exposes, not from a read-only scope at the Brightspace API level. If you want to check it yourself, the whole API client is in `src/api/client.ts`.
