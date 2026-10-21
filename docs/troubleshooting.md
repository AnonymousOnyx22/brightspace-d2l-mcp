# Troubleshooting

Run this first, from any terminal:

```bash
npx brightspace-d2l-mcp doctor
```

`doctor` checks your Node version, your saved school, whether that school can be reached, whether the saved login still works, and which AI apps have Brightspace in their config. Anything wrong gets a line underneath it saying what to do. Fix the first one and run it again.

`npx brightspace-d2l-mcp status` is the short version: your school, your session, and which apps are connected.

Jump to a symptom:

- [Brightspace MCP is not connecting](#brightspace-mcp-is-not-connecting)
- [Setup runs but the browser won't open](#setup-runs-but-the-browser-wont-open)
- [Sign in and SSO failures](#sign-in-and-sso-failures)
- [Still stuck](#still-stuck)

---

## Brightspace MCP is not connecting

The app says the server failed, shows no Brightspace tools, or every question comes back with an error.

### "Brightspace is not set up yet"

Tool calls answer with:

```text
Brightspace is not set up yet. Run `npx -y brightspace-d2l-mcp@latest setup` in a terminal.
```

The server is running fine, no school was ever saved. Run setup once in a terminal.

### Setup ran, but the app shows no Brightspace tools

Apps read their config when they start, so restart the app after setup. Claude Desktop saves its own settings from memory while it is open and would erase the entry: quit it from the tray icon (Quit, not just closing the window), run `npx brightspace-d2l-mcp setup` again, and let it restart the app for you.

### `status` says an app isn't connected

```text
  - Cursor: not connected (run setup)
```

Run setup again, or print the entry with `npx brightspace-d2l-mcp config` and paste it into the app's MCP settings by hand.

### On Windows the entry has to go through `cmd`

The JSON that `npx brightspace-d2l-mcp config` prints uses `cmd /c npx -y brightspace-d2l-mcp@latest` on Windows. If you typed the entry yourself and used bare `npx`, some apps cannot start it. Use the printed JSON.

### Node is too old

You need Node.js 20 or newer. Check with `node --version`. `doctor` reports it as:

```text
Node.js v18.x.x is too old (need 20 or newer)
```

Install the current LTS from [nodejs.org](https://nodejs.org/) and open a new terminal afterwards.

### The server starts, but every tool call returns an error

| The tool says | What is wrong |
|---|---|
| `Could not connect to Brightspace. Check your internet connection.` | Your school cannot be reached from this network. VPN, or a campus network that only answers on campus. `doctor` shows `Can't reach ...` for the same thing |
| `Your Brightspace session expired and signing in again did not finish. Run npx -y brightspace-d2l-mcp@latest setup in a terminal, then try again.` | Sign in once with `npx brightspace-d2l-mcp setup` or `npx brightspace-d2l-mcp login` |
| `Your Brightspace session expired. Run npx -y brightspace-d2l-mcp@latest login in a terminal to sign in again.` | You turned automatic sign in off. Run `login` yourself (see below) |
| `Brightspace could not renew your session right now. Your saved login was kept. Try again in a few minutes.` | The token service did not answer. Your login is intact, so just ask again shortly |
| `Access denied. You may not have permission to access this resource.` | That course or item is not visible to your account |
| `Resource not found. The course or item may not exist, or you may not have access.` | Wrong id, or the item is gone |
| `Rate limited by Brightspace. Please wait a moment and try again.` | Too many requests at once. Wait and ask again |
| `An unexpected error occurred. Please try again.` | Look at the log lines below and open an issue if it keeps happening |

### Watching the log lines

The server prints its log lines to stderr, so they never disturb the tool protocol and your app collects them in its MCP log. To watch them by hand, run the same server your app runs:

```bash
npx -y brightspace-d2l-mcp@latest serve
```

It stays up until you press Ctrl+C and prints a line naming its version and your school, like `brightspace-d2l-mcp v1.4.3 running for https://yourschool.brightspace.com`, plus what it does when you ask a question. A start failure shows up here as `MCP server failed to start`.

### HTTP mode answers 401

For `npx brightspace-d2l-mcp serve --http` (ChatGPT and other web apps):

- The token is the last part of the printed URL, and it also works as an `Authorization: Bearer <token>` header on `/mcp`.
- A wrong or missing token answers `401` with `Missing or wrong access token.`
- The token is stored as `httpToken` in `~/.brightspace-d2l-mcp/config.json`. Delete that line and start the server again to get a new one.
- `--no-auth` is only allowed when listening on localhost, otherwise the server refuses to start.
- `GET /health` returns `{"ok":true,...}` with the version, which tells you the tunnel reaches the server at all.

---

## Setup runs but the browser won't open

Setup prints `Press Enter to open the browser...` and then a Chrome or Edge window should appear. When it doesn't:

### "No supported browser was found"

```text
No supported browser was found. Install Google Chrome or Microsoft Edge, or run
`npx playwright install chromium`, then try again.
```

Setup tries Google Chrome, then Microsoft Edge, then a Chromium copy of its own. Install Chrome, use Edge (already on Windows), or run `npx playwright install chromium` to download one.

### You want a different browser

Set `BRIGHTSPACE_BROWSER_PATH` to the full path of a Chromium based browser executable in the terminal you run setup from:

```bash
BRIGHTSPACE_BROWSER_PATH="/path/to/chrome" npx brightspace-d2l-mcp setup
```

In PowerShell, set it as `$env:BRIGHTSPACE_BROWSER_PATH="C:\Path\To\chrome.exe"` before running setup. When that variable is set it is the only browser tried, so leave it unset to go back to Chrome, Edge and the Chromium copy.

### The sign in browser is already open

```text
The sign-in browser is already open. Finish signing in there, or close it and try again.
```

Only one sign in runs at a time, and it reuses one browser profile. If a window is still open, finish signing in or close it. If no window is open, close any leftover browser process, then delete the folder `~/.brightspace-d2l-mcp/browser-profile` (Windows: `C:\Users\<you>\.brightspace-d2l-mcp\browser-profile`) and run setup again. You only lose the old browser session; your school, settings and saved login stay where they are.

### Nothing happens at all

- Setup asks questions, so run it in a real terminal, not as a background step inside an app. Run it with no terminal and no `--school` and it stops with `No school given. Run again with --school <your Brightspace address>.`
- The window may be behind your other windows. Check the task bar and your other desktop spaces.
- A window needs a desktop. On a server, inside a container, or in a session with no screen there is nowhere for it to open, so run setup on the computer where your AI app runs.

### The terminal window disappears

On Windows, setup closes its own console window a few seconds after it finishes so you are not left with an empty window. You see this first:

```text
This window closes in 10 seconds. Press Enter to close it now, or type k and Enter to keep it open.
```

Press Enter to close it straight away, type `k` to keep it open, or run setup with `--keep-open` (or set `BRIGHTSPACE_KEEP_OPEN`) to skip the countdown. In the terminal inside VS Code it leaves the window alone, and a run that ends in an error keeps the window open on purpose so you can read the message.

### The window closed before you finished signing in

```text
The sign-in window was closed before signing in finished.
```

You get that message right away, and for the next couple of minutes anything that asks for a sign in answers:

```text
Sign-in was cancelled recently. Run `npx -y brightspace-d2l-mcp@latest login` in a terminal, or ask again in a couple of minutes.
```

Wait it out or run `login`.

### A window opens when you ask a question, not during setup

That is how it is built. Starting an AI app never opens a browser by itself; sign in waits for the first tool call. When your school's session runs out, it first tries a hidden sign in with the saved profile, and only opens a window when a person has to do something. If you would rather it never opened a window on its own, add `"autoLogin": false` to `~/.brightspace-d2l-mcp/config.json` and run `npx brightspace-d2l-mcp login` when asked (the environment variable `D2L_AUTO_LOGIN=false` does the same).

---

## Sign in and SSO failures

You sign in with Microsoft, Duo, Okta, Shibboleth or some other school method, and it goes wrong somewhere between the window opening and the tools working.

### "Signed in, but Brightspace did not provide an API token."

You finished signing in, but Brightspace did not hand over a token this server can use. Run `npx brightspace-d2l-mcp login` again and let the Brightspace home page load completely in the window before it closes. If it happens every time on your school, open an issue and say which address you sign in with.

### "Your Brightspace session expired. A browser window is opening so you can sign in again."

Normal, not a bug. Your saved login holds a token that lasts one hour by default (`D2L_TOKEN_TTL` changes that) and is renewed from your browser session for as long as that session lives. Some schools end their session every few hours, so you get asked again sooner. The window opens, you sign in, it closes by itself.

### A window opens every single time

Your school wants a text code, an approval, or a click on an identity provider page each time, and a hidden browser cannot do that for you, so the visible window is the fallback. The server does remember which single sign on entry you used (saved as `ssoEntryUrl` in `config.json`), so a hidden retry goes straight to your school's page instead of stopping on the Brightspace landing page.

### "Your Brightspace session expired. Run ... login in a terminal to sign in again."

You have `"autoLogin": false` in `config.json`, or `D2L_AUTO_LOGIN=false` in the environment, so no window opens on its own. Run `npx brightspace-d2l-mcp login`.

### The window timed out before you finished

```text
Sign-in was not completed within 10 minutes.
```

That is what a question gets when a sign in window waits 10 minutes for you and nothing happens. The `login` command says `Sign-in was not completed in time.` for the same thing. Run `login` again and finish inside that time.

### It says another sign in is still running

One sign in at a time, enforced by the file `login.lock`. If an attempt was killed halfway (window force closed, machine asleep), the lock can stick around. It is treated as stale after 12 minutes and the next attempt proceeds on its own; if you are sure nothing is running, delete `~/.brightspace-d2l-mcp/login.lock` and try again.

### "Brightspace could not be reached. Check your connection and try again."

Same root cause as the network row in the table above. VPN off, campus network that only answers on campus, or the school address is wrong. `npx brightspace-d2l-mcp doctor` reaches your school directly and tells you which it is.

### The school address isn't accepted

Sign in to Brightspace in your own browser, copy the address from the address bar (any page works, not the login page), and paste that. If setup says your site "runs Blackboard" or "Canvas", your school is not on Brightspace.

### It works, then stops with a session error

If you think the saved session itself is damaged, delete it and sign in fresh:

```bash
npx brightspace-d2l-mcp logout
npx brightspace-d2l-mcp login
```

`logout` removes the saved login, the browser profile and the saved cookies, and leaves your school settings and your app configs alone.

---

## Still stuck

Everything this server keeps lives in one folder, `~/.brightspace-d2l-mcp/` (Windows: `C:\Users\<you>\.brightspace-d2l-mcp\`):

| File | What it holds |
|---|---|
| `config.json` | Your school address, course filters, `autoLogin`, and the `httpToken` for HTTP mode |
| `session.json` | The saved login: your API token and the Brightspace session cookies behind it |
| `browser-profile` | The browser used for sign in, so the next sign in can reuse it |
| `browser-cookies.json` | Cookies from the last successful sign in |
| `login.lock` | Makes sure only one sign in runs at a time |

Set `BRIGHTSPACE_MCP_HOME` to keep that folder somewhere else. `logout` deletes `session.json`, `browser-profile` and `browser-cookies.json` and leaves everything else alone. `uninstall` deletes the folder from disk and takes Brightspace out of every app it was added to.

Settings and environment variables are listed in the [setup guide](setup.md), config you paste by hand for any other app is in [apps and agents](agents.md), and the short answers to the common questions are in the [README](../README.md#troubleshooting).

To report a problem, open an issue at https://github.com/AnonymousOnyx22/brightspace-d2l-mcp/issues with the output of `npx brightspace-d2l-mcp doctor`, the exact message you saw, your operating system and your Node version.
