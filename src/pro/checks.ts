import type { DueItem } from "../tools/get-upcoming-due-dates.js";

// Pure decision logic for Pro notifications. The agent feeds it fresh
// Brightspace data plus what it remembered last time, and gets back the
// notifications to show and the state to save.

export interface Notice {
  title: string;
  body: string;
  url?: string;
}

export interface GradeSnapshot {
  key: string; // `${courseId}:${gradeObjectId}`
  courseName: string | null;
  itemName: string;
  displayed: string;
}

export interface ProState {
  /** Alert keys already shown, with the time they were shown. */
  alerted: Record<string, number>;
  /** Last grade seen per course item. Missing until the first successful check. */
  grades?: Record<string, string>;
  /** Local date (YYYY-MM-DD) of the last daily digest. */
  lastDigest?: string;
  /** Last time a "sign in again" notice was shown. */
  lastSignInNotice?: number;
}

export const emptyState = (): ProState => ({ alerted: {} });

const HOUR = 3_600_000;
const TO_DO = new Set(["not_submitted", "draft"]);

const dueMs = (item: DueItem) => new Date(item.dueDate).getTime();
const course = (item: DueItem) => item.courseName ?? "Brightspace";

export function formatDue(ms: number, now: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + 24 * HOUR).toDateString() === d.toDateString();
  if (sameDay) return `today at ${time}`;
  if (tomorrow) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

/** Alerts 24 hours and 2 hours before unsubmitted work is due, once each. */
export function deadlineAlerts(items: DueItem[], state: ProState, now = Date.now()): Notice[] {
  const notices: Notice[] = [];
  for (const item of items) {
    if (!TO_DO.has(item.submissionStatus)) continue;
    const left = dueMs(item) - now;
    if (left <= 0) continue;
    const window = left <= 2 * HOUR ? "2h" : left <= 24 * HOUR ? "24h" : null;
    if (!window) continue;
    const key = `${window}:${item.type}:${item.id}`;
    if (state.alerted[key]) continue;
    // A 2-hour alert replaces a 24-hour one that never fired.
    if (window === "2h") state.alerted[`24h:${item.type}:${item.id}`] ??= now;
    state.alerted[key] = now;
    notices.push({
      title: window === "2h" ? `Due soon: ${item.title}` : `Due in 24 hours: ${item.title}`,
      body: `${course(item)}, due ${formatDue(dueMs(item), now)}. Not submitted yet.`,
      url: item.url,
    });
  }
  return notices;
}

export const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** One summary a day, at or after `hour` local time. */
export function dailyDigest(
  items: DueItem[],
  newAnnouncements: number,
  state: ProState,
  now = Date.now(),
  hour = 8,
): Notice | null {
  const today = localDate(now);
  if (state.lastDigest === today || new Date(now).getHours() < hour) return null;
  state.lastDigest = today;

  const todo = items.filter((i) => TO_DO.has(i.submissionStatus) && dueMs(i) > now);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const dueToday = todo.filter((i) => dueMs(i) <= endOfToday.getTime());
  const thisWeek = todo.filter((i) => dueMs(i) <= now + 7 * 24 * HOUR);

  const parts: string[] = [];
  if (dueToday.length) parts.push(`${dueToday.length} due today`);
  parts.push(`${thisWeek.length} due this week`);
  if (newAnnouncements) parts.push(`${newAnnouncements} new announcement${newAnnouncements === 1 ? "" : "s"}`);
  const next = todo[0];
  const body = parts.join(", ") + "." + (next ? ` Next: ${next.title} (${course(next)}), ${formatDue(dueMs(next), now)}.` : " Nothing left to hand in.");
  return { title: "Your Brightspace day", body };
}

/** New or changed grades since the last check. The first check only records. */
export function gradeAlerts(current: GradeSnapshot[], state: ProState): Notice[] {
  const previous = state.grades;
  const next: Record<string, string> = {};
  for (const g of current) next[g.key] = g.displayed;
  state.grades = next;
  if (!previous) return [];

  const changed = current.filter((g) => g.displayed && previous[g.key] !== g.displayed);
  if (changed.length > 3) {
    return [{ title: `${changed.length} new grades posted`, body: changed.slice(0, 3).map((g) => `${g.itemName}: ${g.displayed}`).join(", ") + ", and more." }];
  }
  return changed.map((g) => ({
    title: `New grade: ${g.itemName}`,
    body: `${g.courseName ?? "Brightspace"}: ${g.displayed}`,
  }));
}

/** Drops alert records older than 30 days so the state file stays small. */
export function pruneState(state: ProState, now = Date.now()): ProState {
  for (const [key, at] of Object.entries(state.alerted)) {
    if (now - at > 30 * 24 * HOUR) delete state.alerted[key];
  }
  return state;
}
