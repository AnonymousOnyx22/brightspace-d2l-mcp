# Changelog

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
