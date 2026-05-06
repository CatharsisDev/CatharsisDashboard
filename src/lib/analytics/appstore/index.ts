import type { AnalyticsProvider, AppMeta, AppSnapshot } from "../types";
import { DEFAULT_PERIOD, periodDays, type Period } from "@/lib/period";
import { loadCredentialsFromEnv } from "./jwt";
import { getAppDetails, listAppStoreApps } from "./apps";
import { listCustomerReviews, summarizeRatings } from "./reviews";
import { getPerformanceMetrics } from "./performance";
import { getDailySales } from "./sales";
import { getSubscriptionsSummary } from "./subscriptions";
import { getAnalyticsReportsBundle, type AnalyticsReportsBundle } from "./analytics-reports";
import { getTestFlightSummary } from "./testflight";

function isConfigured(): boolean {
  return !!loadCredentialsFromEnv();
}

async function listApps(): Promise<AppMeta[]> {
  if (!isConfigured()) return [];
  return listAppStoreApps();
}

export interface FetchSnapshotOptions {
  reviewLimit?: number;
  /** Trailing window. Defaults to DEFAULT_PERIOD (30d). */
  period?: Period;
}

async function fetchSnapshot(
  appId: string,
  options: FetchSnapshotOptions = {},
): Promise<AppSnapshot> {
  const warnings: string[] = [];

  const app = (await getAppDetails(appId)) || {
    id: appId,
    platform: "ios" as const,
    name: "Unknown app",
  };

  const period: Period = options.period ?? DEFAULT_PERIOD;
  const salesDays = periodDays(period);
  const vendorNumber = process.env.APPSTORE_VENDOR_NUMBER;

  // Kick everything off in parallel. Each branch degrades to undefined on
  // failure and appends a warning — no single API error collapses the page.
  const [
    reviews,
    perf,
    salesResult,
    subsResult,
    analyticsBundle,
    testflightResult,
  ] = await Promise.all([
    listCustomerReviews(appId, options.reviewLimit ?? 200).catch((err) => {
      warnings.push(`Could not load reviews: ${err instanceof Error ? err.message : "unknown"}`);
      return [];
    }),
    getPerformanceMetrics(appId).catch((err) => {
      warnings.push(`Could not load perf metrics: ${err instanceof Error ? err.message : "unknown"}`);
      return { metrics: [], crashes: undefined, warning: undefined };
    }),
    vendorNumber
      ? getDailySales(appId, vendorNumber, salesDays).catch((err) => {
          warnings.push(
            `Could not load daily sales: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return { snapshot: null, warning: undefined };
        })
      : Promise.resolve({
          snapshot: null as null,
          warning:
            "Set APPSTORE_VENDOR_NUMBER to enable install counts, proceeds, territories, device split and IAP breakdown from the Sales & Trends API.",
        }),
    vendorNumber
      ? getSubscriptionsSummary(appId, vendorNumber, salesDays).catch((err) => {
          warnings.push(
            `Could not load subscription reports: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return { snapshot: null, warning: undefined };
        })
      : Promise.resolve({ snapshot: null, warning: undefined }),
    getAnalyticsReportsBundle(appId).catch((err) => {
      warnings.push(
        `Could not load Analytics Reports: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return { bundle: {} as AnalyticsReportsBundle, warning: undefined };
    }),
    getTestFlightSummary(appId).catch((err) => {
      warnings.push(
        `Could not load TestFlight data: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return { summary: null, warning: undefined };
    }),
  ]);

  const ratings = summarizeRatings(reviews);
  if (perf.warning) warnings.push(perf.warning);
  if (salesResult.warning) warnings.push(salesResult.warning);
  if (subsResult.warning) warnings.push(subsResult.warning);
  if (analyticsBundle.warning) warnings.push(analyticsBundle.warning);
  if (testflightResult.warning) warnings.push(testflightResult.warning);

  const salesSnap = salesResult.snapshot;
  const analytics = analyticsBundle.bundle;

  return {
    app,
    period,
    ratings,
    reviews: reviews.slice(0, 20),
    installs: salesSnap?.installs,
    crashes: perf.crashes || analytics.crashesFromReports,
    performance: perf.metrics,
    finance: salesSnap?.finance,
    territories: salesSnap?.territories,
    devices: salesSnap?.devices,
    sources: analytics.sources,
    funnel: analytics.funnel,
    subscriptions: subsResult.snapshot ?? undefined,
    iap: salesSnap?.iap,
    searchTerms: analytics.searchTerms,
    appVersions: analytics.appVersions,
    activeDevices: analytics.activeDevices,
    retention: analytics.retention,
    testflight: testflightResult.summary ?? undefined,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export const appstoreProvider: AnalyticsProvider = {
  platform: "ios",
  displayName: "App Store Connect",
  isConfigured,
  listApps,
  fetchSnapshot,
};
