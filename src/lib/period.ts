// Shared time-window selector used across /web, /app, and / dashboards.
// Lives outside any analytics-provider folder because it's pure UX wiring —
// the providers just consume the resolved day count.

export type Period = "7d" | "30d" | "90d" | "365d" | "all";

export const PERIODS: Period[] = ["7d", "30d", "90d", "365d", "all"];
export const DEFAULT_PERIOD: Period = "30d";

/**
 * Maximum day count we ever ask a provider for. Acts as the "all" sentinel —
 * the Play Console export bucket only retains a finite history anyway (and
 * Apple's Sales & Trends caps individual reports daily), so 10 years is
 * effectively unbounded for our purposes.
 */
export const ALL_PERIOD_DAYS = 3650;

/**
 * Map a Period to the trailing day count it represents. Used by every
 * provider whose time-window is expressed in days (App Store Sales &
 * Trends, Play Console Stats CSVs, Play Reporting vitals, etc).
 *
 * "all" returns a very large number so the underlying filters effectively
 * include every row the provider can return. Providers naturally clamp by
 * whatever data they actually have (no API exposes pre-bucket history).
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
    case "all":
      return ALL_PERIOD_DAYS;
  }
}

/**
 * GA4 Data API accepts relative date strings like "7daysAgo". Returning the
 * exact string keeps the caller from having to compute YYYY-MM-DD itself
 * and gets us property-TZ correctness for free.
 */
export function periodToGa4Range(p: Period): { startDate: string; endDate: string } {
  // GA4's earliest acceptable date is "the GA4 property creation date", and
  // it accepts long lookbacks fine. For "all" we ask for everything since
  // 2020-01-01 — well before any property under this account existed.
  if (p === "all") return { startDate: "2020-01-01", endDate: "today" };
  return { startDate: `${periodDays(p)}daysAgo`, endDate: "today" };
}

/**
 * Same idea but for the previous period (used to compute period-over-period
 * deltas on KPI tiles). For a 30d window that's "60daysAgo to 31daysAgo".
 * For "all" we don't compute a prior — there isn't one — so callers get an
 * empty range that returns no rows.
 */
export function periodToGa4PriorRange(p: Period): { startDate: string; endDate: string } {
  if (p === "all") return { startDate: "2020-01-01", endDate: "2020-01-01" };
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
    case "all":
      return "all available data";
  }
}

/** Short pill label rendered inside the toggle. */
export function periodShortLabel(p: Period): string {
  if (p === "all") return "All";
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
