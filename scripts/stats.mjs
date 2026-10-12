#!/usr/bin/env node
// Project stats: npm downloads, GitHub stars, registry versions, and how this
// server compares with the other Brightspace MCP servers.
//
//   npm run stats              Markdown report to stdout
//   npm run stats -- --json    Raw numbers as JSON
//
// Set GITHUB_TOKEN to avoid GitHub's unauthenticated rate limit.
// In GitHub Actions the report is also written to the job summary.

import { readFileSync, appendFileSync } from "node:fs";

const PACKAGE = "brightspace-d2l-mcp";
const REPO = "AnonymousOnyx22/brightspace-d2l-mcp";
const REGISTRY_NAME = "io.github.AnonymousOnyx22/brightspace-d2l-mcp";

// Other Brightspace MCP servers worth tracking: [GitHub repo, npm package or null].
const COMPETITORS = [
  ["RohanMuppa/brightspace-mcp-server", "brightspace-mcp-server"],
  ["JhostinAleck/brightspace-mcp", "brightspace-mcp"],
  ["joshuasoup/d2l-mcp", null],
  ["pranav-vijayananth/brightspace-mcp-server", null],
];

const localVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

async function getJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { "user-agent": `${PACKAGE}-stats`, ...headers }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const githubHeaders = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

async function npmStats(pkg) {
  if (!pkg) return null;
  const [week, month, range, meta] = await Promise.all([
    getJson(`https://api.npmjs.org/downloads/point/last-week/${pkg}`),
    getJson(`https://api.npmjs.org/downloads/point/last-month/${pkg}`),
    getJson(`https://api.npmjs.org/downloads/range/last-month/${pkg}`),
    getJson(`https://registry.npmjs.org/${pkg}`),
  ]);
  return {
    week: week?.downloads ?? null,
    month: month?.downloads ?? null,
    daily: range?.downloads?.map((d) => d.downloads) ?? [],
    latest: meta?.["dist-tags"]?.latest ?? null,
    lastPublish: meta?.time?.[meta?.["dist-tags"]?.latest] ?? null,
    versions: meta?.versions ? Object.keys(meta.versions).length : null,
  };
}

async function githubStats(repo) {
  const data = await getJson(`https://api.github.com/repos/${repo}`, githubHeaders);
  if (!data) return null;
  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.subscribers_count,
    openIssues: data.open_issues_count,
    pushedAt: data.pushed_at,
  };
}

async function trafficStats(repo) {
  // Needs a token with push access to the repo; silently skipped otherwise.
  if (!process.env.GITHUB_TOKEN) return null;
  const [views, clones, referrers] = await Promise.all([
    getJson(`https://api.github.com/repos/${repo}/traffic/views`, githubHeaders),
    getJson(`https://api.github.com/repos/${repo}/traffic/clones`, githubHeaders),
    getJson(`https://api.github.com/repos/${repo}/traffic/popular/referrers`, githubHeaders),
  ]);
  if (!views && !clones) return null;
  return {
    views: views?.count ?? null,
    uniqueVisitors: views?.uniques ?? null,
    clones: clones?.count ?? null,
    uniqueCloners: clones?.uniques ?? null,
    referrers: (referrers ?? []).slice(0, 5).map((r) => `${r.referrer} (${r.uniques})`),
  };
}

async function registryVersion() {
  const data = await getJson(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(PACKAGE)}`);
  const latest = data?.servers?.find(
    (s) => s.server?.name === REGISTRY_NAME && s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest,
  );
  return latest?.server?.version ?? null;
}

function sparkline(values) {
  if (!values.length) return "";
  const bars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 1);
  return values.map((v) => bars[Math.min(bars.length - 1, Math.floor((v / max) * (bars.length - 1)))]).join("");
}

const fmt = (v) => (v === null || v === undefined ? "n/a" : String(v));
const day = (iso) => (iso ? iso.slice(0, 10) : "n/a");

const [ours, gh, traffic, registry, competitors] = await Promise.all([
  npmStats(PACKAGE),
  githubStats(REPO),
  trafficStats(REPO),
  registryVersion(),
  Promise.all(COMPETITORS.map(async ([repo, pkg]) => ({ repo, pkg, gh: await githubStats(repo), npm: await npmStats(pkg) }))),
]);

const report = { generatedAt: new Date().toISOString(), localVersion, npm: ours, github: gh, traffic, registryVersion: registry, competitors };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const warnings = [];
if (ours?.latest && ours.latest !== localVersion) warnings.push(`npm has ${ours.latest} but package.json is ${localVersion}. Publish a release.`);
if (registry && registry !== localVersion) warnings.push(`The MCP Registry has ${registry} but package.json is ${localVersion}.`);

const lines = [
  `# ${PACKAGE} stats`,
  "",
  `_Generated ${report.generatedAt}_`,
  "",
  ...(warnings.length ? ["## ⚠️ Needs attention", "", ...warnings.map((w) => `- ${w}`), ""] : []),
  "## Us",
  "",
  "| Metric | Value |",
  "|---|---|",
  `| npm downloads (last 7 days) | ${fmt(ours?.week)} |`,
  `| npm downloads (last 30 days) | ${fmt(ours?.month)} |`,
  `| Daily trend (30 days) | ${sparkline(ours?.daily ?? []) || "n/a"} |`,
  `| npm latest / package.json | ${fmt(ours?.latest)} / ${localVersion} |`,
  `| MCP Registry version | ${fmt(registry)} |`,
  `| Last npm publish | ${day(ours?.lastPublish)} |`,
  `| GitHub stars / forks / watchers | ${fmt(gh?.stars)} / ${fmt(gh?.forks)} / ${fmt(gh?.watchers)} |`,
  `| Open issues and PRs | ${fmt(gh?.openIssues)} |`,
  ...(traffic
    ? [
        `| Repo views, 14 days (unique) | ${fmt(traffic.views)} (${fmt(traffic.uniqueVisitors)}) |`,
        `| Repo clones, 14 days (unique) | ${fmt(traffic.clones)} (${fmt(traffic.uniqueCloners)}) |`,
        `| Top referrers | ${traffic.referrers.join(", ") || "none"} |`,
      ]
    : []),
  "",
  "## Other Brightspace MCP servers",
  "",
  "| Repo | Stars | Forks | npm / 30 days | npm latest | Last push |",
  "|---|---|---|---|---|---|",
  `| **${REPO}** (us) | ${fmt(gh?.stars)} | ${fmt(gh?.forks)} | ${fmt(ours?.month)} | ${fmt(ours?.latest)} | ${day(gh?.pushedAt)} |`,
  ...competitors.map(
    (c) => `| [${c.repo}](https://github.com/${c.repo}) | ${fmt(c.gh?.stars)} | ${fmt(c.gh?.forks)} | ${fmt(c.npm?.month)} | ${fmt(c.npm?.latest)} | ${day(c.gh?.pushedAt)} |`,
  ),
  "",
];

const markdown = lines.join("\n");
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
