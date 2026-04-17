import { ascFetchJson, AppStoreApiError } from "./client";
import type { PerformanceMetric, CrashStats } from "../types";

// The perfPowerMetrics endpoint returns metric categories with goal bands
// and device-slice datasets. We flatten to a compact list of headline values
// so the dashboard can render them without knowing every Apple schema.

interface AscGoalKeys {
  goalKeys?: string[];
}

interface AscDataset {
  identifier?: string;              // metric identifier, e.g. "LAUNCH_TIME"
  displayName?: string;
  unit?: string;
  goalKeys?: string[];
  percentiles?: { name: string; values?: Array<{ value?: number }> }[];
  points?: { value?: number }[];
}

interface AscCategoryAttributes {
  identifier?: string;              // e.g. "POWER", "PERFORMANCE", "DISK_WRITES"
  datasets?: AscDataset[];
  percentile?: string;
  goalKeys?: AscGoalKeys;
}

interface AscCategoryItem {
  type?: string;
  id?: string;
  attributes?: AscCategoryAttributes;
}

interface PerfPowerResponse {
  data?: AscCategoryItem[];
}

const FRIENDLY: Record<string, string> = {
  LAUNCH: "Launch time",
  LAUNCH_TIME: "Launch time",
  HANG_RATE: "Hang rate",
  HANGS: "Hangs",
  MEMORY: "Memory usage",
  DISK_WRITES: "Disk writes",
  DISK: "Disk usage",
  BATTERY: "Battery usage",
  SCROLL_HITCH_RATE: "Scroll hitches",
  TERMINATIONS: "Background terminations",
  CRASHING: "Crash events",
};

function flattenMetrics(resp: PerfPowerResponse): PerformanceMetric[] {
  const metrics: PerformanceMetric[] = [];
  for (const item of resp.data || []) {
    const catId = item.attributes?.identifier || "UNKNOWN";
    for (const ds of item.attributes?.datasets || []) {
      const id = ds.identifier || catId;
      const label = FRIENDLY[id] || ds.displayName || id;
      // prefer p50 if available
      const p50 = ds.percentiles?.find((p) => p.name === "P50" || p.name === "MEDIAN");
      const headlineValue = p50?.values?.[0]?.value ?? ds.points?.[0]?.value;
      metrics.push({
        identifier: id,
        displayName: label,
        value: typeof headlineValue === "number" ? Number(headlineValue.toFixed(3)) : undefined,
        unit: ds.unit,
      });
    }
  }
  return metrics;
}

function deriveCrashStats(metrics: PerformanceMetric[]): CrashStats | undefined {
  const crashing = metrics.find((m) => /CRASH/i.test(m.identifier));
  const hang = metrics.find((m) => /HANG/i.test(m.identifier));
  if (!crashing && !hang) return undefined;
  return {
    crashCount: typeof crashing?.value === "number" ? crashing.value : undefined,
    hangRate: typeof hang?.value === "number" ? hang.value : undefined,
    note:
      "Sampled from App Store Connect perf/power metrics. True crash counts are available via Xcode Organizer.",
  };
}

export async function getPerformanceMetrics(appId: string): Promise<{
  metrics: PerformanceMetric[];
  crashes?: CrashStats;
  warning?: string;
}> {
  try {
    const res = await ascFetchJson<PerfPowerResponse>(
      `/v1/apps/${encodeURIComponent(appId)}/perfPowerMetrics`,
      {
        query: { "filter[platform]": "IOS", "filter[deviceType]": "all_iphones" },
      },
    );
    const metrics = flattenMetrics(res);
    return { metrics, crashes: deriveCrashStats(metrics) };
  } catch (err) {
    if (err instanceof AppStoreApiError) {
      return {
        metrics: [],
        warning: `Performance metrics not available (${err.status}). Apple only publishes them once the app has enough usage.`,
      };
    }
    throw err;
  }
}
