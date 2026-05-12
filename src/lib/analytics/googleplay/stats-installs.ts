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
const DEFAULT_DAYS = 30;

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
  days: number,
): Promise<Record<string, string>[]> {
  const months = monthsSpanning(days);
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
 * Daily install / uninstall time series + current install base, all derived
 * from the single overview CSV (one fetch covers all three metrics, since
 * Play Console's overview file already has everything in one row per day).
 *
 * Mirrors what Play Console's mobile KPI screen surfaces:
 *   • installs       → "User acquisitions"
 *   • uninstalls     → "User loss"
 *   • activeInstalls → "Total installs" (current install base, not cumulative)
 *
 * We prefer "Daily User Installs/Uninstalls" (one event per unique user) over
 * the device variants because that matches Play Console's defaults and lines
 * up better with iOS's first-time download metric.
 */
export interface InstallsOverview {
  installs?: TimeSeriesStats;
  uninstalls?: TimeSeriesStats;
  activeInstalls?: number;
}

export async function getInstallsOverview(
  bucket: string,
  pkg: string,
  days: number = DEFAULT_DAYS,
): Promise<InstallsOverview | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "overview", days);
  if (!rows.length) return undefined;

  const installsByDate = new Map<string, number>();
  const uninstallsByDate = new Map<string, number>();
  // Active installs is a *snapshot* (not summed) — we just want the most
  // recent day's value within our window.
  const activeByDate = new Map<string, number>();

  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, days)) continue;

    const inst = num(
      pickCol(r, ["Daily User Installs", "Daily Device Installs", "Install events"]),
    );
    installsByDate.set(date, (installsByDate.get(date) || 0) + inst);

    const uninst = num(
      pickCol(r, ["Daily User Uninstalls", "Daily Device Uninstalls", "Uninstall events"]),
    );
    uninstallsByDate.set(date, (uninstallsByDate.get(date) || 0) + uninst);

    // Active install base — Play Console writes a few different columns
    // depending on the export schema generation. The Play Console UI's
    // "Install base" widget tends to match user-account variants where they
    // exist (e.g. "Active User Installs"), and falls back to the device
    // variant otherwise. We try the user variants first so the dashboard
    // tracks the UI number when both are present.
    const active = num(
      pickCol(r, [
        // User-account based — matches Play Console UI when present.
        "Active User Installs",
        "Total User Installs",
        // Device-based — broader inclusion, may differ from UI count.
        "Active Device Installs",
        "Current Device Installs",
        // Older / regional schemas sometimes label it differently.
        "Install base",
        "Active installs",
      ]),
    );
    if (active > 0) activeByDate.set(date, active);
  }

  const installsPoints = Array.from(installsByDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
  const uninstallsPoints = Array.from(uninstallsByDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
  const activeSorted = Array.from(activeByDate.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const installs = installsPoints.length
    ? {
        unit: "installs",
        total: installsPoints.reduce((s, p) => s + p.value, 0),
        points: installsPoints,
      }
    : undefined;
  const uninstalls = uninstallsPoints.length
    ? {
        unit: "uninstalls",
        total: uninstallsPoints.reduce((s, p) => s + p.value, 0),
        points: uninstallsPoints,
      }
    : undefined;
  const activeInstalls = activeSorted.length
    ? activeSorted[activeSorted.length - 1][1]
    : undefined;

  if (!installs && !uninstalls && activeInstalls === undefined) return undefined;
  return { installs, uninstalls, activeInstalls };
}

/**
 * Backward-compat wrapper for callers that only need the installs series.
 * New callers should prefer `getInstallsOverview` to avoid re-reading the
 * same monthly CSVs twice.
 */
export async function getInstallsTimeSeries(
  bucket: string,
  pkg: string,
  days: number = DEFAULT_DAYS,
): Promise<TimeSeriesStats | undefined> {
  const overview = await getInstallsOverview(bucket, pkg, days);
  return overview?.installs;
}

/**
 * Top territories by install volume in the trailing window.
 */
export async function getTerritories(
  bucket: string,
  pkg: string,
  days: number = DEFAULT_DAYS,
): Promise<TerritoryStat[] | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "country", days);
  if (!rows.length) return undefined;

  const byCountry = new Map<string, number>();
  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, days)) continue;
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
 * Top devices by install volume in the trailing window. Play Console
 * device strings are model codes ("hero", "marlin", ...) which are
 * unfriendly but at least show *something*; we leave them as-is rather
 * than guessing at human names.
 */
export async function getDevices(
  bucket: string,
  pkg: string,
  days: number = DEFAULT_DAYS,
): Promise<DeviceStat[] | undefined> {
  const rows = await readMonthlyCsvs(bucket, pkg, "device", days);
  if (!rows.length) return undefined;

  const byDevice = new Map<string, number>();
  for (const r of rows) {
    const date = r["Date"];
    if (!date || !withinWindow(date, days)) continue;
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
