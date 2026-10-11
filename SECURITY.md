# Security

This server is read-only and runs on your own computer. It never stores your password. Your school's own sign-in page handles it in a real browser, and only a session token is saved in `~/.brightspace-d2l-mcp/`.

## Reporting a problem

If you find a security issue, please do not open a public issue. Use GitHub's private reporting instead under the Security tab, then "Report a vulnerability". You should get a reply within a few days.

## How read-only is enforced

- **In the code.** The API client only exposes GET requests. There are no POST, PUT or DELETE methods to call, and the tools only call that client. A test in `tests/tools/read-only.test.ts` fails the build if a write method or a non-GET request is added.
- **In the tool list.** Every `get_` tool is marked `readOnlyHint: true`, so AI apps can tell it doesn't change anything. `download_file` and the calendar export only write files to your own computer.
- **What this does not do.** After you sign in, the server uses your signed-in browser session to get an API access token from Brightspace, and it requests that token with the broadest scope (`*:*:*`). It does not narrow it to a read-only scope, so the token itself would allow writes. The read-only guarantee comes from this server's code and what it exposes, not from a restriction at the Brightspace API level. Narrowing the token scope is on the to-do list, but it needs testing against real Brightspace schools first. The whole API client is in `src/api/client.ts` and the token request is in `src/auth/token-mint.ts` if you want to check.
