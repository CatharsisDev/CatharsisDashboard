import type { CrashStats, PerformanceMetric } from "../types";
import { gpFetchJson, GooglePlayApiError } from "./client";

// Google Play's Reporting API exposes app vitals as "metric sets". Each set
// has a `:query` endpoint that takes a JSON body specifying which metrics +
// dimensions to return over a time range, and hands back rows of values.
//
// Shape example (crashRateMetricSet):
//   POST /v1beta1/apps/{pkg}/crashRateMetricSet:query
//   { "metrics": ["crashRate"],
//     "timelineSpec": {
//        "aggregationPeriod": "DAILY",
//        "startTime": {...}, "endTime": {...} },
//     "dimensions": ["apiLevel"]  (optional) }
//   →
//   { "rows": [
//       { "metrics": {"crashRate": {"decimalValue": {"value": "0.012"}}},
//         "startTime": {...}, "endTime": {...} }
//     ]}
//
// We query with no dimensions to get an aggregate trend, then fold that into
// the provider-agnostic CrashStats / PerformanceMetric shapes.

const REPORTING_BASE = "https://playdeveloperreporting.googleapis.com";

interface GoogleDateTime {
  year?: number;
  month?: number;
  day?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  timeZone?: { id?: string };
}

interface DecimalValue {
  value?: string;
}

interface MetricValue {
  decimalValue?: DecimalValue;
  // Some metrics (counts) come back as an int64 encoded as a string.
  int64Value?: string;
  metricDimensionName?: string;
}

interface Row {
  startTime?: GoogleDateTime;
  endTime?: GoogleDateTime;
  metrics?: Record<string, MetricValue>;
  dimensions?: Array<{ name: string; valueLabel?: string; stringValue?: string }>;
}

interface QueryResponse {
  rows?: Row[];
  nextPageToken?: string;
}

function num(v: MetricValue | undefined): number | undefined {
  if (!v) return undefined;
  if (v.decimalValue?.value !== undefined) {
    const n = Number(v.decimalValue.value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (v.int64Value !== undefined) {
    const n = Number(v.int64Value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function startOfDayUtc(offsetDays: number): GoogleDateTime {
  const d = new Date(Date.now() - offsetDays * 24 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: 0,
    minutes: 0,
    seconds: 0,
    timeZone: { id: "UTC" },
  };
}

function average(rows: Row[] | undefined, metricName: string): number | undefined {
  if (!rows || !rows.length) return undefined;
  const values: number[] = [];
  for (const r of rows) {
    const v = num(r.metrics?.[metricName]);
    if (typeof v === "number") values.push(v);
  }
  if (!values.length) return undefined;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function totalCount(rows: Row[] | undefined, metricName: string): number | undefined {
  if (!rows || !rows.length) return undefined;
  let sum = 0;
  let any = false;
  for (const r of rows) {
    const v = num(r.metrics?.[metricName]);
    if (typeof v === "number") {
      sum += v;
      any = true;
    }
  }
  return any ? sum : undefined;
}

async function queryMetricSet(
  pkg: string,
  metricSet: string,
  metrics: string[],
  days = 28,
): Promise<Row[] | undefined> {
  try {
    const body = {
      metrics,
      timelineSpec: {
        aggregationPeriod: "DAILY",
        startTime: startOfDayUtc(days),
        endTime: startOfDayUtc(0),
      },
    };
    const res = await gpFetchJson<QueryResponse>(
      `/v1beta1/apps/${encodeURIComponent(pkg)}/${metricSet}:query`,
      { method: "POST", body, baseUrl: REPORTING_BASE },
    );
    return res.rows;
  } catch (err) {
    // 403: reporting API not enabled OR not enough active devices to publish
    // aggregates (Google gates metrics below the privacy threshold).
    // 404: app not found in Reporting API yet (freshly published).
    if (err instanceof GooglePlayApiError && (err.status === 403 || err.status === 404)) {
      return undefined;
    }
    throw err;
  }
}

export async function getVitals(
  pkg: string,
): Promise<{
  crashes?: CrashStats;
  performance: PerformanceMetric[];
  warning?: string;
}> {
  // Kick all queries off in parallel. Each metric set is its own endpoint,
  // and Google evaluates privacy thresholds per set, so some may succeed
  // while others return empty.
  const [crashRows, anrRows, errorRows, slowStartRows, slowRenderRows, wakelockRows] =
    await Promise.all([
      queryMetricSet(pkg, "crashRateMetricSet", ["crashRate", "userPerceivedCrashRate"]),
      queryMetricSet(pkg, "anrRateMetricSet", ["anrRate", "userPerceivedAnrRate"]),
      queryMetricSet(pkg, "errorCountMetricSet", ["errorReportCount"]),
      queryMetricSet(pkg, "slowStartRateMetricSet", ["slowStartRate"]),
      queryMetricSet(pkg, "slowRenderingRateMetricSet", ["slowRenderingRate20Fps"]),
      queryMetricSet(pkg, "stuckBackgroundWakelockRateMetricSet", [
        "stuckBackgroundWakelockRate",
      ]),
    ]);

  const crashRate = average(crashRows, "crashRate");
  const userPerceivedCrashRate = average(crashRows, "userPerceivedCrashRate");
  const anrRate = average(anrRows, "anrRate");
  const errorReports = totalCount(errorRows, "errorReportCount");
  const slowStart = average(slowStartRows, "slowStartRate");
  const slowRender = average(slowRenderRows, "slowRenderingRate20Fps");
  const wakelock = average(wakelockRows, "stuckBackgroundWakelockRate");

  const crashes: CrashStats | undefined =
    crashRate !== undefined || userPerceivedCrashRate !== undefined
      ? {
          crashCount: errorReports,
          // Google reports a *rate* (crashes / sessions), not a count of
          // crash-free users. We approximate "crash-free users" as 1 - rate
          // so the iOS panel layout works; flag it in the note.
          crashFreeUsers:
            typeof userPerceivedCrashRate === "number"
              ? 1 - userPerceivedCrashRate
              : typeof crashRate === "number"
                ? 1 - crashRate
                : undefined,
          hangRate: anrRate,
          note:
            "Google Play reports session-weighted rates (crashes / sessions). Crash-free users shown is 1 - user-perceived crash rate, averaged over the last 28 days.",
        }
      : undefined;

  const performance: PerformanceMetric[] = [];
  if (typeof slowStart === "number") {
    performance.push({
      identifier: "SLOW_START",
      displayName: "Slow cold start",
      value: Number((slowStart * 100).toFixed(2)),
      unit: "% of sessions",
    });
  }
  if (typeof slowRender === "number") {
    performance.push({
      identifier: "SLOW_RENDER_20FPS",
      displayName: "Slow rendering (<20fps)",
      value: Number((slowRender * 100).toFixed(2)),
      unit: "% of sessions",
    });
  }
  if (typeof wakelock === "number") {
    performance.push({
      identifier: "STUCK_WAKELOCK",
      displayName: "Stuck wakelocks",
      value: Number((wakelock * 100).toFixed(2)),
      unit: "% of sessions",
    });
  }
  if (typeof crashRate === "number") {
    performance.push({
      identifier: "CRASH_RATE",
      displayName: "Crash rate",
      value: Number((crashRate * 100).toFixed(3)),
      unit: "% of sessions",
    });
  }
  if (typeof anrRate === "number") {
    performance.push({
      identifier: "ANR_RATE",
      displayName: "ANR rate",
      value: Number((anrRate * 100).toFixed(3)),
      unit: "% of sessions",
    });
  }

  const gotAnything =
    crashes ||
    performance.length > 0 ||
    typeof errorReports === "number";

  return {
    crashes,
    performance,
    warning: gotAnything
      ? undefined
      : "Play vitals not yet available for this app — Google needs enough active devices (≥1k daily installs) before publishing aggregates. Check back after the user base grows.",
  };
}
