Where it is meant to go: a reply in Reddit threads or MCP directory comments asking which Brightspace MCP server to use

If you are comparing Brightspace MCP servers, I built one of them, so take this with a grain of salt. I made it because most tools only see due dates, not whether you already handed the work in, so the to do list kept nagging me about finished assignments. This one checks the real submission status for every assignment and skips what is done.

The other two differences: you sign in in a normal browser window, so whatever single sign on your school uses just works, and `get_grade_outlook` tells you what you need on the remaining work to hit a target grade.

I put a table of how the main ones differ in the README: https://github.com/AnonymousOnyx22/brightspace-d2l-mcp#how-it-compares

Install is one line:

```bash
npx brightspace-d2l-mcp setup
```

Read only, open source, no password stored. Works at any school on D2L Brightspace. If the table is out of date for another server, open an issue and I will fix it.
