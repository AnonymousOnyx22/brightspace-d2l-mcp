import * as fs from "node:fs";
import * as path from "node:path";
import { createServer, type Server } from "node:http";
import { D2LApiClient, ApiError } from "../api/index.js";
import { TokenManager } from "../auth/index.js";
import { loadConfig } from "../utils/config.js";
import { dataDir, LOGIN_COMMAND } from "../utils/paths.js";
import { writeFileAtomicSync } from "../utils/atomic-write.js";
import { buildIcs } from "../utils/ics.js";
import { log } from "../utils/logger.js";
import { collectDueItems, resolveCourses, type DueItem } from "../tools/get-upcoming-due-dates.js";
import { isPublishedNewsItem, mapNewsItem } from "../tools/get-announcements.js";
import type { AppConfig } from "../types/index.js";
import { dailyDigest, deadlineAlerts, emptyState, gradeAlerts, pruneState, type GradeSnapshot, type Notice, type ProState } from "./checks.js";
import { notify } from "./notify.js";
import { licenseIsActive } from "./license.js";
import { pidPath } from "./autostart.js";

const DAY = 86_400_000;
export const CHECK_EVERY_MS = 15 * 60_000;
export const CALENDAR_PORT = Number(process.env.BRIGHTSPACE_PRO_CALENDAR_PORT || 47811);
export const calendarUrl = () => `http://127.0.0.1:${CALENDAR_PORT}/calendar.ics`;
export const calendarFile = () => path.join(dataDir(), "brightspace-due-dates.ics");
const statePath = () => path.join(dataDir(), "pro-state.json");

export function readState(): ProState {
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(statePath(), "utf8")) };
  } catch {
    return emptyState();
  }
}

function writeState(state: ProState): void {
  writeFileAtomicSync(statePath(), JSON.stringify(state) + "\n", { mode: 0o600 });
}

interface GradeValue {
  GradeObjectIdentifier: string;
  GradeObjectName: string;
  DisplayedGrade: string;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
}

type NewsItem = Parameters<typeof mapNewsItem>[0];

export interface Snapshot {
  items: DueItem[];
  grades: GradeSnapshot[];
  newAnnouncements: number;
}

export async function fetchSnapshot(apiClient: D2LApiClient, config: AppConfig, now = Date.now()): Promise<Snapshot> {
  const items = await collectDueItems(apiClient, config, { fromMs: -DAY, toMs: 60 * DAY });
  const courses = await resolveCourses(apiClient, config);
  const perCourse = await Promise.allSettled(courses.map(async (course) => {
    const [grades, news] = await Promise.allSettled([
      apiClient.get<GradeValue[]>(apiClient.le(course.id, "/grades/values/myGradeValues/")),
      apiClient.get<NewsItem[]>(apiClient.le(course.id, "/news/")),
    ]);
    const gradeList = grades.status === "fulfilled" && Array.isArray(grades.value) ? grades.value : [];
    const newsList = news.status === "fulfilled" && Array.isArray(news.value) ? news.value : [];
    return {
      grades: gradeList.map((g): GradeSnapshot => ({
        key: `${course.id}:${g.GradeObjectIdentifier}`,
        courseName: course.name,
        itemName: g.GradeObjectName,
        displayed: (g.DisplayedGrade || (g.PointsNumerator != null && g.PointsDenominator ? `${g.PointsNumerator}/${g.PointsDenominator}` : "")).trim(),
      })),
      announcements: newsList
        .filter(isPublishedNewsItem)
        .map(mapNewsItem)
        .filter((n) => n.date !== null && now - new Date(n.date).getTime() < DAY).length,
    };
  }));
  const ok = perCourse.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return {
    items,
    grades: ok.flatMap((c) => c.grades),
    newAnnouncements: ok.reduce((sum, c) => sum + c.announcements, 0),
  };
}

/** Everything one check produces, kept pure apart from the calendar file. */
export function evaluate(snapshot: Snapshot, state: ProState, now = Date.now()): Notice[] {
  const notices = [...deadlineAlerts(snapshot.items, state, now), ...gradeAlerts(snapshot.grades, state)];
  const digest = dailyDigest(snapshot.items, snapshot.newAnnouncements, state, now);
  if (digest) notices.unshift(digest);
  pruneState(state, now);
  return notices;
}

const UNFINISHED = new Set(["not_submitted", "draft", "not_open_yet", "unknown", "restricted"]);

function writeCalendar(items: DueItem[]): void {
  const upcoming = items.filter((i) => UNFINISHED.has(i.submissionStatus) && new Date(i.dueDate).getTime() > Date.now());
  writeFileAtomicSync(calendarFile(), buildIcs(upcoming));
}

export async function runCheck(apiClient: D2LApiClient, config: AppConfig): Promise<void> {
  const state = readState();
  try {
    const snapshot = await fetchSnapshot(apiClient, config);
    writeCalendar(snapshot.items);
    const notices = evaluate(snapshot, state);
    // Several notices at once are hard to read, so cap a single check at four.
    for (const notice of notices.slice(0, 4)) await notify(notice);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (!state.lastSignInNotice || Date.now() - state.lastSignInNotice > DAY) {
        state.lastSignInNotice = Date.now();
        await notify({ title: "Brightspace sign-in expired", body: `Pro alerts are paused. Open a terminal and run: ${LOGIN_COMMAND}` });
      }
    } else {
      log("WARN", "Pro check failed", error);
    }
  }
  writeState(state);
}

function serveCalendar(): Server {
  const server = createServer((req, res) => {
    if (req.url?.split("?")[0] !== "/calendar.ics") {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" }).end(fs.readFileSync(calendarFile()));
    } catch {
      res.writeHead(503).end();
    }
  });
  server.on("error", (error) => log("WARN", "Calendar feed unavailable", error));
  server.listen(CALENDAR_PORT, "127.0.0.1");
  return server;
}

export async function runAgent(): Promise<number> {
  const config = loadConfig();
  if (!config.baseUrl) {
    log("ERROR", "Pro agent: no school set up yet");
    return 1;
  }
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(pidPath(), String(process.pid));
  const cleanup = () => fs.rmSync(pidPath(), { force: true });
  process.on("exit", cleanup);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));

  const apiClient = new D2LApiClient({
    baseUrl: config.baseUrl,
    tokenManager: new TokenManager({ baseUrl: config.baseUrl, tokenTtl: config.tokenTtl }),
  });
  serveCalendar();

  let licenseNoticeShown = false;
  for (;;) {
    if (await licenseIsActive()) {
      licenseNoticeShown = false;
      await runCheck(apiClient, config);
    } else if (!licenseNoticeShown) {
      licenseNoticeShown = true;
      await notify({ title: "Brightspace MCP Pro is paused", body: "Your Pro subscription isn't active. Renew at brightspacemcp.com/pro to turn alerts back on." });
    }
    await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
  }
}
