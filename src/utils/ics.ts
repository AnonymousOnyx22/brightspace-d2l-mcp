export interface CalendarItem {
  type: "assignment" | "quiz";
  id: number;
  title: string;
  courseId: number;
  courseName: string | null;
  dueDate: string;
  url: string;
  submissionStatus: string;
}

const PRODUCT_ID = "-//brightspace-d2l-mcp//Due dates//EN";
const BLOCK_MS = 30 * 60_000;

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets must be folded with a CRLF and a space (RFC 5545). */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (Buffer.byteLength(current + char) > limit) {
      parts.push(current);
      current = char;
      limit = 74; // continuation lines start with a space
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted yet",
  draft: "Draft saved, not submitted",
  not_open_yet: "Not open yet",
  submitted: "Submitted",
  graded: "Graded",
  closed: "Closed",
  past_due: "Past due",
  restricted: "Restricted",
  unknown: "Check Brightspace for status",
};

export function buildIcs(items: CalendarItem[], now = Date.now()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Brightspace due dates",
  ];

  for (const item of items) {
    const due = new Date(item.dueDate).getTime();
    if (!Number.isFinite(due)) continue;

    const course = item.courseName ? `${item.courseName}: ` : "";
    const kind = item.type === "quiz" ? "Quiz" : "Assignment";
    const status = STATUS_LABEL[item.submissionStatus] ?? item.submissionStatus;
    const description = `${kind} due in ${item.courseName ?? `course ${item.courseId}`}.\nStatus: ${status}\n${item.url}`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.type}-${item.courseId}-${item.id}@brightspace-d2l-mcp`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(due - BLOCK_MS)}`,
      `DTEND:${stamp(due)}`,
      `SUMMARY:${escapeIcsText(`${course}${item.title}`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${item.url}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(`Due tomorrow: ${item.title}`)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
