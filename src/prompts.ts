import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

/**
 * Ready-made starting points that show up as slash commands or prompt pickers in apps that support MCP prompts.
 * Each one just tells the AI which tools to use and what a good answer looks like.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "what_should_i_do_now",
    {
      title: "What should I work on right now?",
      description: "Prioritized list of what is left to do, soonest deadline first, skipping anything already handed in.",
    },
    () =>
      userMessage(
        "Call get_todo and tell me what to work on right now. Start with what is due soonest, mention anything overdue " +
          "that can still be submitted, and skip everything I already handed in. Keep it short, with due dates in my local time.",
      ),
  );

  server.registerPrompt(
    "plan_my_week",
    {
      title: "Plan my week",
      description: "Turns the next seven days of deadlines into a day by day plan.",
    },
    () =>
      userMessage(
        "Call get_todo with daysAhead 7 and build me a day by day plan for this week. Put the heaviest or earliest work first, " +
          "spread the rest so no day is overloaded, and flag anything that opens late or needs a quiz check. " +
          "Only include work I have not submitted.",
      ),
  );

  server.registerPrompt(
    "weekly_digest",
    {
      title: "Weekly digest",
      description: "Deadlines, new announcements and recent grades in one summary.",
    },
    () =>
      userMessage(
        "Give me a weekly digest. Use get_todo for what is due, get_announcements for anything my instructors posted this week, " +
          "and get_my_grades for grades that changed recently. Group it as Due, News and Grades, and keep each part to a few lines.",
      ),
  );

  server.registerPrompt(
    "grade_target",
    {
      title: "What do I need to hit my target grade?",
      description: "Works out the score needed on the remaining work in a course to reach a target.",
      argsSchema: {
        course: z.string().optional().describe("Course name or code"),
        target: z.string().optional().describe("Target grade as a percentage, for example 80"),
      },
    },
    ({ course, target }) =>
      userMessage(
        `Use get_my_courses to find ${course ? `my course "${course}"` : "the course I mean (ask me if it is unclear)"}, ` +
          `then call get_grade_outlook${target ? ` with targetPercent ${target}` : ""}. ` +
          "Tell me where I stand now, the best and worst final grade I could still get, and the average I need on what is left. " +
          "If the course has no weights, read get_syllabus to find them.",
      ),
  );

  server.registerPrompt(
    "exam_prep",
    {
      title: "Prepare for an exam",
      description: "Pulls together the syllabus, course content and announcements for one course to build a study plan.",
      argsSchema: {
        course: z.string().optional().describe("Course name or code"),
        examDate: z.string().optional().describe("When the exam is, for example 'next Friday'"),
      },
    },
    ({ course, examDate }) =>
      userMessage(
        `Help me prepare for an exam in ${course ? `"${course}"` : "my course (ask which one if unclear)"}${examDate ? `, ${examDate}` : ""}. ` +
          "Find the course with get_my_courses, then read get_syllabus, get_course_content and get_announcements for what the exam covers. " +
          "Build a study plan that works back from the exam date, lists the topics and the materials to review for each, " +
          "and checks get_todo so the plan does not clash with other deadlines.",
      ),
  );

  server.registerPrompt(
    "summarize_assignment",
    {
      title: "Summarize an assignment",
      description: "Reads the instructions and rubric for an assignment and explains what is actually being asked.",
      argsSchema: {
        assignment: z.string().optional().describe("Assignment name"),
        course: z.string().optional().describe("Course name or code"),
      },
    },
    ({ assignment, course }) =>
      userMessage(
        `Explain ${assignment ? `the assignment "${assignment}"` : "my next assignment"}${course ? ` in "${course}"` : ""}. ` +
          "Use get_assignments to find it, then get_assignment_files to read the instructions and rubric. " +
          "Give me the deliverables, the deadline, how it is marked and a short checklist to work through.",
      ),
  );

  server.registerPrompt(
    "put_deadlines_in_my_calendar",
    {
      title: "Put my deadlines in my calendar",
      description: "Exports upcoming unfinished work as a calendar file.",
    },
    () =>
      userMessage(
        "Call export_due_dates_calendar for the next 30 days and give me the .ics file so I can add my deadlines to my calendar. " +
          "If you can create calendar events directly with another tool, offer that instead.",
      ),
  );
}
