import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { D2LApiClient, DEFAULT_CACHE_TTLS } from "../api/index.js";
import { GetGradeOutlookSchema } from "./schemas.js";
import { toolResponse, sanitizeError } from "./tool-helpers.js";
import { computeGradeOutlook } from "../utils/grade-math.js";

interface GradeValue {
  GradeObjectName: string;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
  WeightedNumerator: number | null;
  WeightedDenominator: number | null;
}

export function registerGetGradeOutlook(server: McpServer, apiClient: D2LApiClient): void {
  server.registerTool(
    "get_grade_outlook",
    {
      title: "Grade Outlook And Target Calculator",
      description:
        "Works out where the user stands in one course and what they need on the remaining work to reach a target grade. " +
        "Returns the current percentage, the best and worst possible final grade, and the average they must score on " +
        "everything left to hit targetPercent. Use for \"what do I need on the final to get 80?\", \"can I still pass?\" " +
        "or \"am I on track?\". For the raw grade items, use get_my_grades instead.",
      inputSchema: GetGradeOutlookSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args: unknown) => {
      try {
        const { courseId, targetPercent, totalWeight } = GetGradeOutlookSchema.parse(args);
        const values = await apiClient.get<GradeValue[]>(apiClient.le(courseId, "/grades/values/myGradeValues/"), {
          ttl: DEFAULT_CACHE_TTLS.grades,
        });
        const outlook = computeGradeOutlook(
          values.map((value) => ({
            name: value.GradeObjectName,
            pointsNumerator: value.PointsNumerator,
            pointsDenominator: value.PointsDenominator,
            weightedNumerator: value.WeightedNumerator,
            weightedDenominator: value.WeightedDenominator,
          })),
          { targetPercent, totalWeight },
        );
        return toolResponse({ courseId, ...outlook });
      } catch (error) {
        return sanitizeError(error);
      }
    },
  );
}
