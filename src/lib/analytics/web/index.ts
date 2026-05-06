import { DEFAULT_PERIOD, type Period } from "@/lib/period";
import { ensureWebConfig, isWebConfigured } from "./client";
import {
  getDaily,
  getDevices,
  getGeography,
  getKeyEvents,
  getKpis,
  getPriorPeriodKpis,
  getSources,
  getTopPages,
} from "./queries";
import type { WebSnapshot } from "./types";

export {
  isWebConfigured,
};
export { inspectWebConfig } from "./credentials";
export type {
  WebDailyPoint,
  WebDeviceStat,
  WebGeoStat,
  WebKeyEventStat,
  WebKpis,
  WebSnapshot,
  WebTopPage,
  WebTrafficSource,
} from "./types";

/**
 * Prior-period KPIs are returned alongside the snapshot so the page can
 * render deltas like "↑12% vs prior 30d" on the header tiles. Kept on a
 * separate field so the WebSnapshot type stays clean and the rest of the
 * UI doesn't need to care about it.
 */
export interface WebSnapshotResult {
  snapshot: WebSnapshot;
  priorKpis?: import("./types").WebKpis;
}

/**
 * Pull every panel's data in parallel. Each fetcher degrades to a warning +
 * undefined value rather than collapsing the page — same pattern as the iOS /
 * Android providers.
 */
export async function fetchWebSnapshot(
  period: Period = DEFAULT_PERIOD,
): Promise<WebSnapshotResult> {
  const cfg = ensureWebConfig();
  const warnings: string[] = [];

  const wrap = async <T>(label: string, p: Promise<T>): Promise<T | undefined> => {
    try {
      return await p;
    } catch (err) {
      warnings.push(
        `${label}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      return undefined;
    }
  };

  const [
    kpis,
    priorKpis,
    daily,
    topPages,
    sources,
    geography,
    devices,
    keyEvents,
  ] = await Promise.all([
    wrap("KPIs", getKpis(cfg.propertyId, period)),
    wrap("Prior-period KPIs", getPriorPeriodKpis(cfg.propertyId, period)),
    wrap("Daily traffic", getDaily(cfg.propertyId, period)),
    wrap("Top pages", getTopPages(cfg.propertyId, period)),
    wrap("Traffic sources", getSources(cfg.propertyId, period)),
    wrap("Geography", getGeography(cfg.propertyId, period)),
    wrap("Devices", getDevices(cfg.propertyId, period)),
    wrap("Key events", getKeyEvents(cfg.propertyId, period)),
  ]);

  // First-time-property hint: if everything is empty, the property either
  // hasn't recorded any traffic yet or the refresh token doesn't carry
  // analytics.readonly. The 401/403 path already produces a warning; this
  // catches the silent "valid but empty" case.
  if (
    !kpis?.activeUsers &&
    !kpis?.sessions &&
    !daily?.length &&
    !topPages?.length &&
    !warnings.length
  ) {
    warnings.push(
      `No traffic recorded for property ${cfg.propertyId} in this window. ` +
        "If you just installed the GA4 tag, give it ~24 hours to start reporting.",
    );
  }

  const snapshot: WebSnapshot = {
    propertyId: cfg.propertyId,
    hostname: cfg.hostname,
    period,
    kpis: kpis || {},
    daily,
    topPages,
    sources,
    geography,
    devices,
    keyEvents,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  return { snapshot, priorKpis };
}
