// Shared time-window selector used across /web, /app, and / dashboards.
// Lives outside any analytics-provider folder because it's pure UX wiring —
// the providers just consume the resolved day count.

export type Period = "7d" | "30d" | "90d" | "365d";

export const PERIODS: Period[] = ["7d", "30d", "90d", "365d"];
export const DEFAULT_PERIOD: Period = "30d";

/**
 * Map a Period to the trailing day count it represents. Used by every
 * provider whose time-window is expressed in days (App Store Sales &
 * Trends, Play Console Stats CSVs, Play Reporting vitals, etc).
 */
export function periodDays(p: Period): number {
  switch (p) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "365d":
      return 365;
  }
}

/**
 * GA4 Data API accepts relative date strings like "7daysAgo". Returning the
 * exact string keeps the caller from having to compute YYYY-MM-DD itself
 * and gets us property-TZ correctness for free.
 */
export function periodToGa4Range(p: Period): { startDate: string; endDate: string } {
  return { startDate: `${periodDays(p)}daysAgo`, endDate: "today" };
}

/**
 * Same idea but for the previous period (used to compute period-over-period
 * deltas on KPI tiles). For a 30d window that's "60daysAgo to 31daysAgo".
 */
export function periodToGa4PriorRange(p: Period): { startDate: string; endDate: string } {
  const days = periodDays(p);
  return { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };
}

/**
 * Display label for KPI sub-text and headers. We want
 *   "Active users (last 7 days)"
 * rather than the abbreviated "(7d)" — easier to skim on the page.
 */
export function periodLabel(p: Period): string {
  switch (p) {
    case "7d":
      return "last 7 days";
    case "30d":
      return "last 30 days";
    case "90d":
      return "last 90 days";
    case "365d":
      return "last 365 days";
  }
}

/** Short pill label rendered inside the toggle. */
export function periodShortLabel(p: Period): string {
  return p.toUpperCase().replace("D", "d");
}

/**
 * Parse `?period=` from a Next.js searchParams record. Falls back to the
 * default if the param is missing or unrecognized — never throws, never
 * surfaces invalid state to the user.
 */
export function parsePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return DEFAULT_PERIOD;
  if ((PERIODS as string[]).includes(v)) return v as Period;
  return DEFAULT_PERIOD;
}

/**
 * Some Play Console + iOS sub-fetchers cap below 365 days because Google's
 * Reports API rejects longer windows on certain metric sets and Apple's
 * Analytics Reports API only publishes ~7 trailing processing days
 * regardless of what we ask for. Callers use this to clamp without losing
 * the user's requested window for *other* metrics.
 */
export function clampDays(period: Period, maxDays: number): number {
  return Math.min(periodDays(period), maxDays);
}
