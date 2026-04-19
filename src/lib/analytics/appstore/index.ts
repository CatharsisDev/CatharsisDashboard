import type { AnalyticsProvider, AppMeta, AppSnapshot } from "../types";
import { loadCredentialsFromEnv } from "./jwt";
import { getAppDetails, listAppStoreApps } from "./apps";
import { listCustomerReviews, summarizeRatings } from "./reviews";
import { getPerformanceMetrics } from "./performance";
import { getDailySales } from "./sales";

function isConfigured(): boolean {
  return !!loadCredentialsFromEnv();
}

async function listApps(): Promise<AppMeta[]> {
  if (!isConfigured()) return [];
  return listAppStoreApps();
}

export interface FetchSnapshotOptions {
  reviewLimit?: number;
  salesDays?: number;
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

  const [reviews, perf] = await Promise.all([
    listCustomerReviews(appId, options.reviewLimit ?? 200).catch((err) => {
      warnings.push(`Could not load reviews: ${err instanceof Error ? err.message : "unknown"}`);
      return [];
    }),
    getPerformanceMetrics(appId).catch((err) => {
      warnings.push(`Could not load perf metrics: ${err instanceof Error ? err.message : "unknown"}`);
      return { metrics: [], crashes: undefined, warning: undefined };
    }),
  ]);

  const ratings = summarizeRatings(reviews);
  if (perf.warning) warnings.push(perf.warning);

  // Installs: only attempt sales reports when a vendor number is provided.
  const vendorNumber = process.env.APPSTORE_VENDOR_NUMBER;
  let installs: AppSnapshot["installs"];
  if (vendorNumber) {
    try {
      const sales = await getDailySales(appId, vendorNumber, options.salesDays ?? 7);
      if (sales.warning) warnings.push(sales.warning);
      if (sales.snapshot) installs = sales.snapshot.installs;
    } catch (err) {
      warnings.push(
        `Could not load daily sales: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  } else {
    warnings.push(
      "Set APPSTORE_VENDOR_NUMBER to enable install counts from the Sales & Trends API.",
    );
  }

  return {
    app,
    ratings,
    reviews: reviews.slice(0, 20),
    installs,
    crashes: perf.crashes,
    performance: perf.metrics,
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
