# Setup guide

This walks through setting up Brightspace for your AI apps from scratch. It takes about a minute.

- [1. Install Node.js](#1-install-nodejs)
- [2. Run setup](#2-run-setup)
- [3. Enter your school](#3-enter-your-school)
- [4. Sign in](#4-sign-in)
- [5. Connect your AI apps](#5-connect-your-ai-apps)
- [6. Try it](#6-try-it)
- [Signing in later](#signing-in-later)
- [Manual setup for other apps](#manual-setup-for-other-apps)
- [Removing it](#removing-it)

---

## 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org/) and install it with the default options.

To check it worked, open a terminal and run:

```bash
node --version
```

You should see `v20` or higher.

> **Where's the terminal?**
> **Windows:** press Start, type `PowerShell`, press Enter.
> **Mac:** press ⌘ Space, type `Terminal`, press Enter.

You also need **Google Chrome** or **Microsoft Edge**. Edge comes with Windows, so most people already have one.

## 2. Run setup

In the terminal, run:

```bash
npx brightspace-d2l-mcp setup
```

If it asks `Ok to proceed? (y)`, press Enter.

## 3. Enter your school

```
Step 1/3  Your school
  Open Brightspace in your browser and copy the link from the address bar.
  Brightspace address:
```

Open Brightspace in your browser like you normally would, copy the address from the address bar, and paste it in.
Any Brightspace page works: the home page, a course, or an assignment.

You can also just type the short name if your school's address is `something.brightspace.com` or `something.desire2learn.com`:

```
  Brightspace address: yourschool
  ✔ Brightspace found at https://yourschool.brightspace.com
```

| If you see | What to do |
|---|---|
| "That's your school's sign-in page" | You copied the login page. Sign in first, then copy the address of the Brightspace page. |
| "runs Blackboard / Canvas" | Your school uses a different system, so this tool won't work there. |
| "Couldn't reach" | Check your internet connection and the spelling. |

## 4. Sign in

```
Step 2/3  Sign in
  A browser window will open on your Brightspace sign-in page.
  Press Enter to open the browser...
```

Press Enter and a Chrome or Edge window opens on your school's Brightspace. **Sign in exactly the way you normally do**: click your school's SSO button if there is one, enter your password, and approve the text code or authenticator prompt.

When Brightspace finishes loading, the window closes by itself:

```
  ✔ Signed in as Alex Student
```

Setup never sees your password. You're typing it into your school's own page.

## 5. Connect your AI apps

```
Step 3/3  Connect your AI apps
  Found: Claude Desktop, Claude Code, Cursor
  Connect all of them? (Y/n)
```

Press Enter to connect everything it found, or type `n` to choose one at a time.

- **Claude Desktop** saves its own settings while it's running and would undo the change, so setup offers to restart it for you. Say yes.
- **Claude Code** is also set to use the Brightspace tools without asking permission every time.
- **Cursor, VS Code and Windsurf:** restart them, or reload the window, after setup.

## 6. Try it

Open your AI app and ask:

- "What should I work on right now?"
- "What's due this week?"
- "What are my grades?"

In Claude Desktop you'll see **brightspace** under the tools (🔨) menu in the chat box.

---

## Signing in later

You normally won't have to think about this. When your school's session ends:

1. It first tries to sign back in quietly in the background, which usually works.
2. If your school wants you to sign in again, a browser window opens. Sign in and it closes by itself.

To sign in right away:

```bash
npx brightspace-d2l-mcp login
```

To check everything:

```bash
npx brightspace-d2l-mcp status
```

```
brightspace-d2l-mcp v1.0.0
  ✔ School: https://yourschool.brightspace.com
  ✔ Session: signed in
  ✔ Claude Desktop: connected
  ✔ Claude Code: connected
```

## Manual setup for other apps

Any app that supports MCP servers can use this. Add a server named `brightspace` with this command.

**macOS / Linux**

```json
{
  "mcpServers": {
    "brightspace": {
      "command": "npx",
      "args": ["-y", "brightspace-d2l-mcp@latest"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "brightspace": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "brightspace-d2l-mcp@latest"]
    }
  }
}
```

Run `npx brightspace-d2l-mcp setup --apps none` once first to choose your school and sign in.

## Settings

Settings live in `~/.brightspace-d2l-mcp/config.json` (on Windows: `C:\Users\<you>\.brightspace-d2l-mcp\config.json`).

| Setting | Default | What it does |
|---|---|---|
| `baseUrl` | set by setup | Your school's Brightspace address |
| `autoLogin` | `true` | Open a sign-in window automatically when needed. Set `false` to only use `login`. |
| `includeCourses` | all | Only show these course ids |
| `excludeCourses` | none | Hide these course ids |
| `activeOnly` | `true` | Hide courses that are no longer active |

Environment variables override the file: `D2L_BASE_URL`, `D2L_AUTO_LOGIN`, `D2L_INCLUDE_COURSES`, `D2L_EXCLUDE_COURSES`, `D2L_ACTIVE_ONLY`.
Set `BRIGHTSPACE_BROWSER_PATH` to use a specific Chromium-based browser.

## Removing it

```bash
npx brightspace-d2l-mcp uninstall
```

This removes Brightspace from every AI app it was added to and deletes the saved session, browser profile and settings.
