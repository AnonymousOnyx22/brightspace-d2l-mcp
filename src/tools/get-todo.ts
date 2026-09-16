import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient } from "../api/index.js";
import { GetTodoSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { collectDueItems, type DueItem } from "./get-upcoming-due-dates.js";
import type { AppConfig } from "../types/index.js";

const DAY = 86_400_000;

const DONE = new Set(["submitted", "graded"]);
const TO_DO = new Set(["not_submitted", "draft"]);
const LATER = new Set(["not_open_yet"]);

function hoursUntil(item: DueItem, now: number): number {
  return Math.round((new Date(item.dueDate).getTime() - now) / 3_600_000);
}

export function buildTodo(unsorted: DueItem[], now = Date.now()) {
  const annotate = (item: DueItem) => ({ ...item, hoursUntilDue: hoursUntil(item, now) });
  const due = (item: DueItem) => new Date(item.dueDate).getTime();
  const items = [...unsorted].sort((a, b) => due(a) - due(b));

  const overdue = items.filter((i) => TO_DO.has(i.submissionStatus) && due(i) < now).map(annotate);
  const toDo = items.filter((i) => TO_DO.has(i.submissionStatus) && due(i) >= now).map(annotate);
  const notOpenYet = items.filter((i) => LATER.has(i.submissionStatus)).map(annotate);
  const checkYourself = items
    .filter((i) => !DONE.has(i.submissionStatus) && !TO_DO.has(i.submissionStatus) && !LATER.has(i.submissionStatus) && due(i) >= now)
    .map(annotate);
  const alreadyDone = items.filter((i) => DONE.has(i.submissionStatus)).map((i) => ({
    title: i.title,
    courseName: i.courseName,
    dueDate: i.dueDate,
    submissionStatus: i.submissionStatus,
    submittedDate: i.submittedDate,
  }));

  return {
    generatedAt: new Date(now).toISOString(),
    guidance:
      "Recommend from doNow first (soonest due first), then overdue if it can still be submitted. " +
      "Never recommend alreadyDone items. notOpenYet cannot be submitted until its startDate. " +
      "checkYourself items (quizzes, restricted dropboxes) have unknown completion; ask the user. Dates are UTC.",
    doNow: toDo,
    overdue,
    notOpenYet,
    checkYourself,
    alreadyDone,
  };
}

export function registerGetTodo(server: McpServer, apiClient: D2LApiClient, config: AppConfig): void {
  server.registerTool(
    "get_todo",
    {
      title: "What To Do Now",
      description:
        "Prioritized to-do list across all courses: unfinished work due soon, recently overdue work, " +
        "work not open yet, items to double-check (quizzes), and work already submitted. " +
        "Use this first when the user asks what to work on, what's left, or what they should do now.",
      inputSchema: GetTodoSchema,
    },
    async (args: unknown) => {
      try {
        const { daysAhead, includeOverdueDays } = GetTodoSchema.parse(args);
        const items = await collectDueItems(apiClient, config, {
          fromMs: -includeOverdueDays * DAY,
          toMs: daysAhead * DAY,
        });
        return toolResponse(buildTodo(items));
      } catch (error) {
        return sanitizeError(error);
      }
    }
  );
}
