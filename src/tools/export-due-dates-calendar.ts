import * as fs from "node:fs/promises";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient } from "../api/index.js";
import { ExportDueDatesCalendarSchema } from "./schemas.js";
import { toolResponse, errorResponse, sanitizeError } from "./tool-helpers.js";
import { collectDueItems } from "./get-upcoming-due-dates.js";
import { buildIcs } from "../utils/ics.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import type { AppConfig } from "../types/index.js";

const DAY = 86_400_000;
const DONE = new Set(["submitted", "graded"]);
export const CALENDAR_FILENAME = "brightspace-due-dates.ics";

export function registerExportDueDatesCalendar(server: McpServer, apiClient: D2LApiClient, config: AppConfig): void {
  server.registerTool(
    "export_due_dates_calendar",
    {
      title: "Export Due Dates To Calendar",
      description:
        "Builds an iCalendar (.ics) file of upcoming assignments and quizzes that opens in Google Calendar, Apple Calendar " +
        "and Outlook. Each event has a link back to Brightspace and a one day reminder. By default only unfinished work is " +
        "included. Pass downloadPath (an absolute folder) to save the file, otherwise the calendar text is returned.",
      inputSchema: ExportDueDatesCalendarSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: unknown) => {
      try {
        const { daysAhead, courseId, includeSubmitted, downloadPath } = ExportDueDatesCalendarSchema.parse(args);
        if (downloadPath && !path.isAbsolute(downloadPath)) {
          return errorResponse("downloadPath must be an absolute path to a folder.");
        }

        const items = await collectDueItems(apiClient, config, { fromMs: 0, toMs: daysAhead * DAY, courseId });
        const chosen = includeSubmitted ? items : items.filter((item) => !DONE.has(item.submissionStatus));
        const ics = buildIcs(chosen);

        if (!downloadPath) return toolResponse({ eventCount: chosen.length, filename: CALENDAR_FILENAME, ics });

        await fs.mkdir(downloadPath, { recursive: true });
        const savedTo = path.join(downloadPath, CALENDAR_FILENAME);
        await writeFileAtomic(savedTo, ics);
        return toolResponse({ eventCount: chosen.length, savedTo });
      } catch (error) {
        return sanitizeError(error);
      }
    },
  );
}
