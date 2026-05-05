import { runReport, type RunReportResponse } from "./client";
import type {
  WebDailyPoint,
  WebDeviceStat,
  WebGeoStat,
  WebKeyEventStat,
  WebKpis,
  WebTopPage,
  WebTrafficSource,
} from "./types";

// All queries operate on a trailing 30-day window. GA4 understands relative
// strings like "30daysAgo" so we don't have to compute YYYY-MM-DD ourselves;
// it's also TZ-correct (uses the property's configured time zone).
const DATE_RANGE = { startDate: "30daysAgo", endDate: "today" } as const;
const PREV_DATE_RANGE = { startDate: "60daysAgo", endDate: "31daysAgo" } as const;

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- KPI strip ----------------------------------------------------------
//
// We pull all five header metrics in one report (one row, no dimensions) so
// it's a single round trip. GA4 returns them in the same order we requested,
// indexed by metricHeaders[i].name.
export async function getKpis(propertyId: string): Promise<WebKpis> {
  const res = await runReport(propertyId, {
    metrics: [
      { name: "activeUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "averageSessionDuration" },
      // userEngagementDuration / sessions is what GA4 calls "average
      // engagement time per session". We compute it client-side because GA4's
      // canonical metric (`engagementRate`) is a different number.
      { name: "userEngagementDuration" },
      { name: "keyEvents" },
    ],
    dateRanges: [DATE_RANGE],
  });

  const get = (name: string): number | undefined => {
    const idx = res.metricHeaders?.findIndex((h) => h.name === name) ?? -1;
    if (idx < 0) return undefined;
    const v = res.rows?.[0]?.metricValues?.[idx]?.value;
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const sessions = get("sessions");
  const userEngagementDuration = get("userEngagementDuration"); // seconds, summed
  const avgEngagementTimeSec =
    sessions && sessions > 0 && userEngagementDuration !== undefined
      ? userEngagementDuration / sessions
      : undefined;

  return {
    activeUsers: get("activeUsers"),
    sessions,
    pageViews: get("screenPageViews"),
    avgEngagementTimeSec,
    keyEvents: get("keyEvents"),
  };
}

// ---- Daily traffic time series ------------------------------------------
//
// One row per day with sessions + activeUsers. Sorted ascending so the chart
// reads left-to-right. GA4 returns the date as 'YYYYMMDD' which we reformat
// to ISO for display consistency with the iOS / Android panels.
export async function getDaily(propertyId: string): Promise<WebDailyPoint[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    dateRanges: [DATE_RANGE],
    orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    limit: 31,
  });

  const sIdx = res.metricHeaders?.findIndex((h) => h.name === "sessions") ?? -1;
  const uIdx = res.metricHeaders?.findIndex((h) => h.name === "activeUsers") ?? -1;
  return (res.rows || []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value || "";
    const iso =
      raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : raw;
    return {
      date: iso,
      sessions: sIdx >= 0 ? num(r.metricValues?.[sIdx]?.value) : 0,
      activeUsers: uIdx >= 0 ? num(r.metricValues?.[uIdx]?.value) : 0,
    };
  });
}

// ---- Top pages ----------------------------------------------------------
//
// Order by views desc, cap at 25. We pull pageTitle alongside pagePath so
// the table can fall back to the title when the path is just `/`.
export async function getTopPages(propertyId: string): Promise<WebTopPage[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "activeUsers" },
      { name: "userEngagementDuration" },
    ],
    dateRanges: [DATE_RANGE],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: 25,
  });

  const viewsIdx = res.metricHeaders?.findIndex((h) => h.name === "screenPageViews") ?? -1;
  const usersIdx = res.metricHeaders?.findIndex((h) => h.name === "activeUsers") ?? -1;
  const engIdx = res.metricHeaders?.findIndex((h) => h.name === "userEngagementDuration") ?? -1;

  return (res.rows || []).map((r) => {
    const path = r.dimensionValues?.[0]?.value || "/";
    const title = r.dimensionValues?.[1]?.value || undefined;
    const views = viewsIdx >= 0 ? num(r.metricValues?.[viewsIdx]?.value) : 0;
    const users = usersIdx >= 0 ? num(r.metricValues?.[usersIdx]?.value) : 0;
    // Per-page engagement time: total engagement on this page / users on
    // this page. Approximation — GA4's per-page engagement metric isn't
    // exposed in the Data API.
    const totalEng = engIdx >= 0 ? num(r.metricValues?.[engIdx]?.value) : 0;
    const avgEngagementTimeSec = users > 0 ? totalEng / users : undefined;
    return { path, title, views, users, avgEngagementTimeSec };
  });
}

// ---- Traffic sources ----------------------------------------------------
export async function getSources(propertyId: string): Promise<WebTrafficSource[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    dateRanges: [DATE_RANGE],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 25,
  });

  const sIdx = res.metricHeaders?.findIndex((h) => h.name === "sessions") ?? -1;
  const uIdx = res.metricHeaders?.findIndex((h) => h.name === "activeUsers") ?? -1;

  return (res.rows || []).map((r) => ({
    source: r.dimensionValues?.[0]?.value || "(not set)",
    medium: r.dimensionValues?.[1]?.value || "(none)",
    sessions: sIdx >= 0 ? num(r.metricValues?.[sIdx]?.value) : 0,
    users: uIdx >= 0 ? num(r.metricValues?.[uIdx]?.value) : 0,
  }));
}

// ---- Geography ----------------------------------------------------------
export async function getGeography(propertyId: string): Promise<WebGeoStat[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "country" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    dateRanges: [DATE_RANGE],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 25,
  });

  const sIdx = res.metricHeaders?.findIndex((h) => h.name === "sessions") ?? -1;
  const uIdx = res.metricHeaders?.findIndex((h) => h.name === "activeUsers") ?? -1;

  return (res.rows || []).map((r) => ({
    country: r.dimensionValues?.[0]?.value || "(unknown)",
    sessions: sIdx >= 0 ? num(r.metricValues?.[sIdx]?.value) : 0,
    users: uIdx >= 0 ? num(r.metricValues?.[uIdx]?.value) : 0,
  }));
}

// ---- Devices ------------------------------------------------------------
export async function getDevices(propertyId: string): Promise<WebDeviceStat[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    dateRanges: [DATE_RANGE],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });

  const sIdx = res.metricHeaders?.findIndex((h) => h.name === "sessions") ?? -1;
  const uIdx = res.metricHeaders?.findIndex((h) => h.name === "activeUsers") ?? -1;

  const rows = (res.rows || []).map((r) => ({
    category: r.dimensionValues?.[0]?.value || "(unknown)",
    sessions: sIdx >= 0 ? num(r.metricValues?.[sIdx]?.value) : 0,
    users: uIdx >= 0 ? num(r.metricValues?.[uIdx]?.value) : 0,
  }));
  const total = rows.reduce((s, r) => s + r.sessions, 0);
  return rows.map((r) => ({
    ...r,
    share: total > 0 ? r.sessions / total : undefined,
  }));
}

// ---- Key events (conversions) -------------------------------------------
//
// GA4 publishes per-event counts via the `eventName` dimension and `keyEvents`
// metric. We filter out rows where keyEvents is 0 — that filters down to just
// the events the user has actually flagged as key events in GA4. If they
// haven't flagged any, this returns an empty list and the panel shows an
// empty-state message rather than rendering noise.
export async function getKeyEvents(propertyId: string): Promise<WebKeyEventStat[]> {
  const res = await runReport(propertyId, {
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "keyEvents" }, { name: "sessions" }],
    dateRanges: [DATE_RANGE],
    orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
    limit: 25,
  });

  const eIdx = res.metricHeaders?.findIndex((h) => h.name === "keyEvents") ?? -1;
  const sIdx = res.metricHeaders?.findIndex((h) => h.name === "sessions") ?? -1;

  return (res.rows || [])
    .map((r) => {
      const count = eIdx >= 0 ? num(r.metricValues?.[eIdx]?.value) : 0;
      const sessions = sIdx >= 0 ? num(r.metricValues?.[sIdx]?.value) : 0;
      return {
        name: r.dimensionValues?.[0]?.value || "(unnamed)",
        count,
        conversionRate: sessions > 0 ? count / sessions : undefined,
      };
    })
    .filter((r) => r.count > 0);
}

// ---- Period-over-period KPI deltas (used in the header sub-text) ---------
//
// One report per metric kept compact by batching all metrics in a single
// runReport with the previous-period date range. Returns the prior 30-day
// totals so the page can compute deltas like "↑12% vs prior 30d".
export async function getPriorPeriodKpis(propertyId: string): Promise<WebKpis> {
  const res: RunReportResponse = await runReport(propertyId, {
    metrics: [
      { name: "activeUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "userEngagementDuration" },
      { name: "keyEvents" },
    ],
    dateRanges: [PREV_DATE_RANGE],
  });

  const get = (name: string): number | undefined => {
    const idx = res.metricHeaders?.findIndex((h) => h.name === name) ?? -1;
    if (idx < 0) return undefined;
    const v = res.rows?.[0]?.metricValues?.[idx]?.value;
    return v === undefined || v === "" ? undefined : Number(v);
  };
  const sessions = get("sessions");
  const userEng = get("userEngagementDuration");
  return {
    activeUsers: get("activeUsers"),
    sessions,
    pageViews: get("screenPageViews"),
    avgEngagementTimeSec:
      sessions && sessions > 0 && userEng !== undefined ? userEng / sessions : undefined,
    keyEvents: get("keyEvents"),
  };
}
