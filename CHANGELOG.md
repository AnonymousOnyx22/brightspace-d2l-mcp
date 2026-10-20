# Changelog

## 1.4.2

- Bump dependencies and assert version sync in release tests

## 1.4.1

- Make expired-session errors actionable in src/api/errors.ts
- Sync llms.txt and glama.json to the 17 tools and 9 prompts
- Put a vs-competitors table on the README first screen
- Add an example prompt to every tool description in src/index.ts
- Rewrite the npm description to lead with 'Brightspace MCP server'
- Update the MCP SDK to 1.32.1, playwright-core to 1.64.1, zod to 4.6.7 and unpdf to 1.9.1
- Keep file-type on 21 and vitest on 4, because those releases need Node 22 and this server still runs on Node 20
- Add release tests that keep package.json, server.json and the registry entry on one version, and that keep the build and test gate before publishing

## 1.4.0

- Update check. Running a command like `npx brightspace-d2l-mcp setup` on an older version now says which version is out and asks "Update now? (Y/n)". Yes switches to the new version and carries on with the same command. It never asks when an AI app runs the server, in CI, with `--yes`, or when `BRIGHTSPACE_NO_UPDATE_CHECK` is set.
- Running `npx brightspace-d2l-mcp` with no command in a terminal now shows help instead of silently starting the server. AI apps are unaffected.

## 1.3.0

- Setup closes its window when it finishes on Windows, after a 10 second countdown. Press Enter to close it straight away, type k to keep it open, or pass `--keep-open`. Every command now exits as soon as it is done, so the terminal is never left hanging.
- New `get_calendar_events` tool. It reads the course calendars for exams, tests, labs, classes and other events instructors post, so you can ask "when is my midterm?". Search by text and look up to 180 days ahead.
- New `get_whats_new` tool. One catch-up across every course: new announcements, newly marked work you have not opened, unread discussion posts and quizzes you have not tried.
- New prompts `catch_me_up` and `when_are_my_exams`. `weekly_digest` now includes events and newly marked work.
- Fixed releases not reaching npm and the MCP Registry. 1.1.0 and 1.2.0 never published because npm refused the upload; the workflow now accepts trusted publishing or an `NPM_TOKEN` secret, explains what to set up when npm refuses, and publishes to the MCP Registry right after npm.
- New `npm run stats` and a weekly `stats` workflow that report npm downloads, GitHub stars and traffic, registry versions, and how this server compares with other Brightspace MCP servers.
- Removed the unused write methods from the API client, marked every `get_` tool read only, and added a test that fails if a write request is ever added. Documented how read-only is enforced in SECURITY.md.

## 1.2.0

- New `get_grade_outlook` tool. It shows where you stand in a course, your best and worst possible final grade, and the average you need on the remaining work to reach a target grade ("what do I need on the final to get an 80?").
- New `export_due_dates_calendar` tool. It builds an .ics file of your unfinished deadlines that opens in Google Calendar, Apple Calendar and Outlook, with a link back to Brightspace and a one day reminder on each event.
- New built-in MCP prompts for apps that show prompt shortcuts: `what_should_i_do_now`, `plan_my_week`, `weekly_digest`, `grade_target`, `exam_prep`, `summarize_assignment` and `put_deadlines_in_my_calendar`.
- README, `llms.txt` and package keywords updated so people searching for these features can find them.

## 1.1.0

- New `doctor` command. It checks Node, your saved school, whether Brightspace is reachable, your saved sign-in, your connected AI apps and the latest npm version, and says how to fix each problem.
- Clearer tool descriptions so AI agents pick the right tool, for example `get_todo` vs `get_upcoming_due_dates` and `get_roster` vs `get_classlist_emails`.
- Downloads badge, `llms.txt` and README improvements.

## 1.0.0

- First release. 13 read-only tools for due dates with real submission status, grades, assignments, rubrics, course content, announcements, discussions, rosters and syllabi.
