import { gunzipSync } from "node:zlib";
import { ascAuthHeader, ascFetchJson, AppStoreApiError } from "./client";
import type {
  ActiveDevicesSummary,
  AppVersionStat,
  CrashStats,
  FunnelSummary,
  RetentionCohort,
  SearchTermStat,
  SourceStat,
  TimeSeriesPoint,
} from "../types";

// App Store Connect Analytics Reports API (distinct from Sales & Trends).
//
// Flow is asynchronous:
//   1. POST /v1/analyticsReportRequests with { accessType: "ONGOING" } per app
//      → creates a long-lived report request that Apple fulfills daily.
//   2. GET /v1/analyticsReportRequests/{id}/reports
//      → list of report categories (impressions, sessions, crashes, search terms, ...).
//   3. GET /v1/analyticsReports/{id}/instances?filter[granularity]=DAILY
//      → list of per-day instances.
//   4. GET /v1/analyticsReportInstances/{id}/segments
//      → list of segments with download URLs.
//   5. Fetch the segment URL (gzipped CSV), parse.
//
// A freshly-created request can take ~24 hours before any instances are available.
// We cache the request id per-appId in-process; the UI surfaces a warning when
// nothing is ready yet.

interface Relationship {
  data?: { id: string; type: string } | { id: string; type: string }[] | null;
}

interface JsonApiItem<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes?: A;
  relationships?: Record<string, Relationship>;
}

interface AnalyticsReportRequestAttrs {
  accessType?: "ONE_TIME_SNAPSHOT" | "ONGOING";
  stoppedDueToInactivity?: boolean;
}

interface AnalyticsReportAttrs {
  name?: string;
  category?: string;
}

interface AnalyticsReportInstanceAttrs {
  granularity?: "DAILY" | "WEEKLY" | "MONTHLY";
  processingDate?: string;
}

interface AnalyticsReportSegmentAttrs {
  checksum?: string;
  sizeInBytes?: number;
  url?: string;
}

const requestIdCache = new Map<string, string>();

async function listRequestsForApp(appId: string): Promise<JsonApiItem<AnalyticsReportRequestAttrs>[]> {
  const res = await ascFetchJson<{ data: JsonApiItem<AnalyticsReportRequestAttrs>[] }>(
    `/v1/apps/${encodeURIComponent(appId)}/analyticsReportRequests`,
    { query: { "filter[accessType]": "ONGOING", limit: 200 } },
  );
  return res.data || [];
}

// ascFetch* helpers don't take a body. For this one POST, fetch directly and
// reuse the same JWT auth header.
async function createOngoingRequest(appId: string): Promise<string> {
  const res = await fetch("https://api.appstoreconnect.apple.com/v1/analyticsReportRequests", {
    method: "POST",
    headers: {
      Authorization: ascAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: {
          app: { data: { type: "apps", id: appId } },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new AppStoreApiError(res.status, await res.text().catch(() => ""));
  }
  const json = (await res.json()) as { data: JsonApiItem<AnalyticsReportRequestAttrs> };
  return json.data.id;
}

async function ensureRequest(appId: string): Promise<{ id: string; justCreated: boolean }> {
  const cached = requestIdCache.get(appId);
  if (cached) return { id: cached, justCreated: false };

  const existing = await listRequestsForApp(appId);
  const active = existing.find(
    (r) => !r.attributes?.stoppedDueToInactivity && r.attributes?.accessType === "ONGOING",
  );
  if (active) {
    requestIdCache.set(appId, active.id);
    return { id: active.id, justCreated: false };
  }

  const id = await createOngoingRequest(appId);
  requestIdCache.set(appId, id);
  return { id, justCreated: true };
}

async function listReports(requestId: string): Promise<JsonApiItem<AnalyticsReportAttrs>[]> {
  const res = await ascFetchJson<{ data: JsonApiItem<AnalyticsReportAttrs>[] }>(
    `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports`,
    { query: { limit: 200 } },
  );
  return res.data || [];
}

async function listInstances(
  reportId: string,
  granularity: "DAILY" | "WEEKLY" | "MONTHLY" = "DAILY",
  limit = 10,
): Promise<JsonApiItem<AnalyticsReportInstanceAttrs>[]> {
  const res = await ascFetchJson<{ data: JsonApiItem<AnalyticsReportInstanceAttrs>[] }>(
    `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances`,
    {
      query: {
        "filter[granularity]": granularity,
        limit,
      },
    },
  );
  // Sort newest first — API doesn't guarantee order.
  const list = res.data || [];
  return list.sort((a, b) => {
    const ad = a.attributes?.processingDate || "";
    const bd = b.attributes?.processingDate || "";
    return bd.localeCompare(ad);
  });
}

async function listSegments(
  instanceId: string,
): Promise<JsonApiItem<AnalyticsReportSegmentAttrs>[]> {
  const res = await ascFetchJson<{ data: JsonApiItem<AnalyticsReportSegmentAttrs>[] }>(
    `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments`,
    { query: { limit: 200 } },
  );
  return res.data || [];
}

async function downloadSegment(url: string): Promise<string> {
  // Segment download URLs are short-lived S3 URLs. No auth needed on the URL itself.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Segment download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Segments are gzipped CSV. Try to decompress; if it fails, return raw text.
  try {
    return gunzipSync(buf).toString("utf8");
  } catch {
    return buf.toString("utf8");
  }
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV parser that handles quoted fields with embedded commas.
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface FetchedReport {
  name: string;
  rows: Record<string, string>[];
  latestDate?: string;
}

interface ReportPlan {
  // Apple's analyticsReports endpoint returns reports with names like
  // "App Store Engagement", "App Store Discovery and Engagement",
  // "App Store Commerce", "App Sessions", "App Crashes",
  // "App Store Installation and Deletion", etc.
  // We match flexibly because Apple occasionally renames.
  match: RegExp;
  label: string;
}

const PLAN: Record<string, ReportPlan> = {
  discovery: { match: /discovery.*engagement|engagement.*discovery/i, label: "Discovery & Engagement" },
  commerce: { match: /\bcommerce\b/i, label: "Commerce" },
  sessions: { match: /\bsessions?\b|usage/i, label: "Sessions" },
  crashes: { match: /crash/i, label: "Crashes" },
  installation: { match: /install|deletion/i, label: "Installation & Deletion" },
};

async function fetchLatestReport(
  requestId: string,
  match: RegExp,
  granularity: "DAILY" | "WEEKLY" | "MONTHLY" = "DAILY",
  days = 7,
): Promise<FetchedReport | null> {
  const reports = await listReports(requestId);
  const report = reports.find((r) => match.test(r.attributes?.name || ""));
  if (!report) return null;

  const instances = await listInstances(report.id, granularity, Math.max(10, days));
  if (!instances.length) return null;

  const rows: Record<string, string>[] = [];
  const dateSet = new Set<string>();

  for (const inst of instances.slice(0, days)) {
    const processingDate = inst.attributes?.processingDate;
    if (processingDate) dateSet.add(processingDate);
    const segments = await listSegments(inst.id);
    for (const seg of segments) {
      const url = seg.attributes?.url;
      if (!url) continue;
      const text = await downloadSegment(url);
      const parsed = parseCsv(text);
      for (const row of parsed) {
        if (processingDate && !row["Date"] && !row["Processing Date"]) {
          row["Date"] = processingDate;
        }
        rows.push(row);
      }
    }
  }

  const latestDate = [...dateSet].sort().pop();
  return { name: report.attributes?.name || "Unknown report", rows, latestDate };
}

function daysBackList(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let offset = 1; offset <= n; offset++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
    );
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

function toTimeSeries(rows: Record<string, string>[], field: string): TimeSeriesPoint[] {
  const byDate: Record<string, number> = {};
  for (const r of rows) {
    const date = (r["Date"] || r["Processing Date"] || "").slice(0, 10);
    if (!date) continue;
    byDate[date] = (byDate[date] || 0) + num(r[field]);
  }
  return Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

export interface AnalyticsReportsBundle {
  funnel?: FunnelSummary;
  sources?: SourceStat[];
  searchTerms?: SearchTermStat[];
  activeDevices?: ActiveDevicesSummary;
  retention?: RetentionCohort[];
  appVersions?: AppVersionStat[];
  crashesFromReports?: CrashStats;
  note?: string;
}

/**
 * Best-effort loader: creates the ongoing report request if missing, then
 * tries to download each target report. Any report that fails silently
 * degrades to undefined so the UI can still render the other panels.
 */
export async function getAnalyticsReportsBundle(
  appId: string,
): Promise<{ bundle: AnalyticsReportsBundle; warning?: string }> {
  let requestId: string;
  let justCreated = false;
  try {
    const r = await ensureRequest(appId);
    requestId = r.id;
    justCreated = r.justCreated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      bundle: {},
      warning: `Analytics Reports API: could not create or find report request (${msg}).`,
    };
  }

  if (justCreated) {
    return {
      bundle: {},
      warning:
        "Analytics Reports request created. Apple typically makes the first daily reports available ~24 hours after creation — reload tomorrow to see impressions, page views, crashes, sources, and search terms.",
    };
  }

  // Discover available reports once so we skip ones Apple hasn't produced.
  let reports: JsonApiItem<AnalyticsReportAttrs>[];
  try {
    reports = await listReports(requestId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      bundle: {},
      warning: `Analytics Reports API: could not list reports (${msg}).`,
    };
  }

  if (!reports.length) {
    return {
      bundle: {},
      warning:
        "Analytics Reports request exists but Apple hasn't produced any reports yet. First reports typically arrive ~24h after the request is created.",
    };
  }

  const bundle: AnalyticsReportsBundle = {};
  const settle = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  // Commerce / Discovery reports contain the funnel data (impressions, page views,
  // first-time downloads). Column names vary across reports; try a few aliases.
  const discovery = await settle(() =>
    fetchLatestReport(requestId, PLAN.discovery.match, "DAILY", 7),
  );
  if (discovery && discovery.rows.length) {
    const impressions = discovery.rows.reduce(
      (s, r) => s + (num(r["Impressions"]) || num(r["Impressions (Unique Devices)"])),
      0,
    );
    const pageViews = discovery.rows.reduce(
      (s, r) =>
        s +
        (num(r["Product Page Views"]) ||
          num(r["Product Page Views (Unique Devices)"]) ||
          num(r["Page Views"])),
      0,
    );
    const impressionsSeries = toTimeSeries(discovery.rows, "Impressions");
    const pageViewsSeries = toTimeSeries(discovery.rows, "Product Page Views");
    bundle.funnel = {
      impressions,
      productPageViews: pageViews,
      firstTimeDownloads: undefined,
      conversionRate: undefined,
      impressionsSeries: impressionsSeries.length ? impressionsSeries : undefined,
      pageViewsSeries: pageViewsSeries.length ? pageViewsSeries : undefined,
    };

    // Sources: column "Source Type" values are "App Store Search",
    // "App Store Browse", "Web Referrer", "App Referrer", "Institutional Purchase".
    const byType: Record<string, number> = {};
    for (const r of discovery.rows) {
      const type = r["Source Type"] || r["Traffic Source"] || "";
      if (!type) continue;
      byType[type] = (byType[type] || 0) + num(r["Product Page Views"]);
    }
    const totalViews = Object.values(byType).reduce((s, v) => s + v, 0);
    if (totalViews > 0) {
      bundle.sources = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([source, units]) => ({ source, units, share: units / totalViews }));
    }

    // Search terms: some reports include a "Search Term" column.
    const bySearch: Record<
      string,
      { impressions: number; pageViews: number; downloads: number }
    > = {};
    for (const r of discovery.rows) {
      const term = r["Search Term"] || r["Term"];
      if (!term) continue;
      if (!bySearch[term]) bySearch[term] = { impressions: 0, pageViews: 0, downloads: 0 };
      bySearch[term].impressions += num(r["Impressions"]);
      bySearch[term].pageViews += num(r["Product Page Views"]);
      bySearch[term].downloads += num(r["First-Time Downloads"]);
    }
    const totalSearchImpressions =
      Object.values(bySearch).reduce((s, v) => s + v.impressions, 0) || 1;
    const searchTerms = Object.entries(bySearch)
      .map(([term, v]) => ({
        term,
        impressions: v.impressions,
        pageViews: v.pageViews,
        downloads: v.downloads,
        share: v.impressions / totalSearchImpressions,
      }))
      .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
      .slice(0, 50);
    if (searchTerms.length) bundle.searchTerms = searchTerms;
  }

  const commerce = await settle(() =>
    fetchLatestReport(requestId, PLAN.commerce.match, "DAILY", 7),
  );
  if (commerce && commerce.rows.length) {
    const ftdField = "First-Time Downloads";
    const downloads = commerce.rows.reduce((s, r) => s + num(r[ftdField]), 0);
    if (bundle.funnel) {
      bundle.funnel.firstTimeDownloads = downloads;
      const impressions = bundle.funnel.impressions;
      if (impressions && downloads > 0) {
        bundle.funnel.conversionRate = downloads / impressions;
      }
    } else if (downloads) {
      bundle.funnel = { firstTimeDownloads: downloads };
    }
  }

  const sessions = await settle(() =>
    fetchLatestReport(requestId, PLAN.sessions.match, "DAILY", 7),
  );
  if (sessions && sessions.rows.length) {
    // Active devices often come as "Active Devices", "Active Devices Last 30 Days", etc.
    const daily = sessions.rows
      .map((r) => num(r["Active Devices"]))
      .filter((n) => n > 0);
    const weekly = sessions.rows.reduce(
      (s, r) => Math.max(s, num(r["Active Devices Last 7 Days"]) || 0),
      0,
    );
    const monthly = sessions.rows.reduce(
      (s, r) => Math.max(s, num(r["Active Devices Last 30 Days"]) || 0),
      0,
    );
    const sessionsCount = sessions.rows.reduce((s, r) => s + num(r["Sessions"]), 0);
    const totalDaily = daily.reduce((s, n) => s + n, 0);
    const avgDaily = daily.length ? totalDaily / daily.length : undefined;
    const sessionsPerDevice =
      avgDaily && avgDaily > 0 ? sessionsCount / (avgDaily * daily.length) : undefined;
    bundle.activeDevices = {
      daily: avgDaily ? Math.round(avgDaily) : undefined,
      weekly: weekly || undefined,
      monthly: monthly || undefined,
      sessionsPerDevice,
    };

    // App versions: some sessions reports carry "App Version" column.
    const byVersion: Record<string, number> = {};
    for (const r of sessions.rows) {
      const v = r["App Version"] || r["Version"];
      if (!v) continue;
      byVersion[v] = (byVersion[v] || 0) + num(r["Active Devices"]);
    }
    const totalVersionDevices = Object.values(byVersion).reduce((s, v) => s + v, 0);
    if (totalVersionDevices > 0) {
      bundle.appVersions = Object.entries(byVersion)
        .sort((a, b) => b[1] - a[1])
        .map(([version, units]) => ({
          version,
          adoption: units / totalVersionDevices,
        }));
    }
  }

  const crashes = await settle(() =>
    fetchLatestReport(requestId, PLAN.crashes.match, "DAILY", 7),
  );
  if (crashes && crashes.rows.length) {
    const total = crashes.rows.reduce((s, r) => s + num(r["Crashes"]), 0);
    const cfUsers = crashes.rows
      .map((r) => num(r["Crashes per Active Device"]) || num(r["Crash Rate"]))
      .filter((v) => v > 0);
    const avg = cfUsers.length ? cfUsers.reduce((s, n) => s + n, 0) / cfUsers.length : undefined;
    bundle.crashesFromReports = {
      crashCount: total,
      hangRate: avg,
      note: "Aggregated from App Store Connect Analytics Reports API (last 7 processing days).",
    };
  }

  // Retention: dedicated report sometimes present. We look for "Retention" in names.
  const retention = await settle(() =>
    fetchLatestReport(requestId, /retention/i, "WEEKLY", 8),
  );
  if (retention && retention.rows.length) {
    const cohorts: Record<string, { day1: number[]; day7: number[]; day28: number[] }> = {};
    for (const r of retention.rows) {
      const cohort = r["Cohort Date"] || r["Processing Date"] || r["Date"];
      if (!cohort) continue;
      if (!cohorts[cohort]) cohorts[cohort] = { day1: [], day7: [], day28: [] };
      if (r["Day 1"]) cohorts[cohort].day1.push(num(r["Day 1"]));
      if (r["Day 7"]) cohorts[cohort].day7.push(num(r["Day 7"]));
      if (r["Day 28"]) cohorts[cohort].day28.push(num(r["Day 28"]));
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : undefined);
    const list = Object.entries(cohorts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cohortDate, v]) => ({
        cohortDate,
        day1: mean(v.day1),
        day7: mean(v.day7),
        day28: mean(v.day28),
      }));
    if (list.length) bundle.retention = list;
  }

  // Ensure there's always a date range hint so UIs can label the window.
  if (!Object.keys(bundle).length) {
    return {
      bundle,
      warning:
        "Analytics Reports are available but none of the target reports (Discovery & Engagement, Commerce, Sessions, Crashes) had data for the last 7 processing days.",
    };
  }
  bundle.note = `Window: last 7 processing days ending ~${daysBackList(1)[0]}`;
  return { bundle };
}
