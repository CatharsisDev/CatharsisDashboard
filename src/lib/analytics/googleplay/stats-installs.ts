import type { DeviceStat, TerritoryStat, TimeSeriesStats } from "../types";
import { downloadCsv, monthsSpanning, parseCsvRows } from "./stats-bucket";

// Play Console export file naming convention (under the bucket root):
//
//   stats/installs/installs_{packageName}_YYYYMM_overview.csv
//   stats/installs/installs_{packageName}_YYYYMM_country.csv
//   stats/installs/installs_{packageName}_YYYYMM_device.csv
//
// One file per package per *month*. To cover the trailing 30 days we may
// need both the current and previous month's files.
//
// Column names in those CSVs have shifted around over the years; we look
// the values up by header name and fall back to known synonyms so a Play
// schema tweak doesn't silently zero out the panel.

const STATS_PREFIX = "stats/installs";
const DAYS = 30;

function num(v: string | undefined): number {
  if (!v) return 0;
  // Play Console writes numbers as plain digits with no thousands separator,
  // and uses an empty string when the metric wasn't measured that day.
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pickCol(row: Record<string, string>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return undefined;
}

async function readMonthlyCsvs(
  bucket: string,
  pkg: string,
  suffix: "overview" | "country" | "device",
): Promise<Record<string, string>[]> {
  const months = monthsSpanning(DAYS);
  const all: Record<string, string>[] = [];
  for (const ym of months) {
    const name = `${STATS_PREFIX}/installs_${pkg}_${ym}_${suffix}.csv`;
    const text = await downloadCsv(bucket, name);
    if (!text) continue;
    for (const row of parseCsvRows(text)) all.push(row);
  }
  return all;
}

function withinWindow(dateStr: string, days: number): boolean {
  // Play Console writes dates as `YYYY-MM-DD` in the bucket's timezone (PT).
  // We just compare against the cutoff in UTC; off-by-one is fine for a
  // rolling 30-day display.
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (!Number.isFinite(d)) return false;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  return d >= cutoff;
}

/**
 * Daily install time series for the trailing 30 days. We prefer "Daily User
 * Installs" (one install event per unique user) over device installs because
 * it matches what Play Console's UI shows by default and lines up better
 * with iOS's first-time download metric.
 */
export async function getInstallsTimeSeries(
  bucket: string,
  pkg: string,
): Promise<TimeSeriesStats | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "overview");
  if (!rows.length) return undefined;

  // Aggregate by date in case a row is split across multiple lines (rare).
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, DAYS)) continue;
    const v = num(
      pickCol(r, ["Daily User Installs", "Daily Device Installs", "Install events"]),
    );
    byDate.set(date, (byDate.get(date) || 0) + v);
  }
  if (!byDate.size) return undefined;

  const points = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
  const total = points.reduce((s, p) => s + p.value, 0);
  return { unit: "installs", total, points };
}

/**
 * Top territories by install volume in the trailing 30 days.
 */
export async function getTerritories(
  bucket: string,
  pkg: string,
): Promise<TerritoryStat[] | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "country");
  if (!rows.length) return undefined;

  const byCountry = new Map<string, number>();
  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, DAYS)) continue;
    const code = (r["Country"] || "").trim();
    if (!code) continue;
    const v = num(pickCol(r, ["Daily User Installs", "Daily Device Installs"]));
    if (v <= 0) continue;
    byCountry.set(code, (byCountry.get(code) || 0) + v);
  }
  if (!byCountry.size) return undefined;

  return Array.from(byCountry.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([territory, units]) => ({ territory, units }));
}

/**
 * Top devices by install volume in the trailing 30 days. Play Console
 * device strings are model codes ("hero", "marlin", ...) which are
 * unfriendly but at least show *something*; we leave them as-is rather
 * than guessing at human names.
 */
export async function getDevices(
  bucket: string,
  pkg: string,
): Promise<DeviceStat[] | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "device");
  if (!rows.length) return undefined;

  const byDevice = new Map<string, number>();
  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, DAYS)) continue;
    const dev = (r["Device"] || "").trim();
    if (!dev) continue;
    const v = num(pickCol(r, ["Daily User Installs", "Daily Device Installs"]));
    if (v <= 0) continue;
    byDevice.set(dev, (byDevice.get(dev) || 0) + v);
  }
  if (!byDevice.size) return undefined;

  const total = Array.from(byDevice.values()).reduce((s, v) => s + v, 0);
  return Array.from(byDevice.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([device, units]) => ({
      device,
      units,
      share: total > 0 ? units / total : undefined,
    }));
}
