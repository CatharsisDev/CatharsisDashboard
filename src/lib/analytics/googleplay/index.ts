import type { AnalyticsProvider, AppMeta, AppSnapshot } from "../types";
import { loadCredentialsFromEnv } from "./credentials";
import { getAppDetails, listGooglePlayApps } from "./apps";
import { listCustomerReviews, summarizeRatings } from "./reviews";
import { getIapCatalog, getSubscriptionCatalog } from "./monetization";
import { getVitals } from "./vitals";

function isConfigured(): boolean {
  try {
    return !!loadCredentialsFromEnv();
  } catch {
    // loadCredentialsFromEnv throws on malformed JSON. Surface that as "not
    // configured" so the page shows the setup state rather than a crash.
    return false;
  }
}

async function listApps(): Promise<AppMeta[]> {
  if (!isConfigured()) return [];
  return listGooglePlayApps();
}

async function fetchSnapshot(appId: string): Promise<AppSnapshot> {
  const warnings: string[] = [];

  const app = (await getAppDetails(appId)) || {
    id: appId,
    platform: "android" as const,
    name: "Unknown app",
    packageName: appId,
  };

  // Kick every independent fetcher off in parallel. Each one degrades
  // gracefully — a failure appends a warning instead of collapsing the page.
  const [reviews, iapResult, subsResult, vitalsResult] = await Promise.all([
    listCustomerReviews(appId, 200).catch((err) => {
      warnings.push(`Could not load reviews: ${err instanceof Error ? err.message : "unknown"}`);
      return [];
    }),
    getIapCatalog(appId).catch((err) => {
      warnings.push(`Could not load IAP catalog: ${err instanceof Error ? err.message : "unknown"}`);
      return { summary: undefined, warning: undefined };
    }),
    getSubscriptionCatalog(appId).catch((err) => {
      warnings.push(
        `Could not load subscription catalog: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return { summary: undefined, warning: undefined };
    }),
    getVitals(appId).catch((err) => {
      warnings.push(`Could not load Play vitals: ${err instanceof Error ? err.message : "unknown"}`);
      return { crashes: undefined, performance: [], warning: undefined };
    }),
  ]);

  const ratings = summarizeRatings(reviews);
  if (iapResult.warning) warnings.push(iapResult.warning);
  if (subsResult.warning) warnings.push(subsResult.warning);
  if (vitalsResult.warning) warnings.push(vitalsResult.warning);

  // Tell the user about the big structural gap versus iOS: install counts,
  // proceeds, territories, device split, traffic sources, funnel, active
  // users, retention, search terms — those all live in the Play Console
  // Financial / Statistics CSV bucket, which we intentionally don't pull.
  warnings.push(
    "Google Play installs, revenue, territories, traffic sources, funnel and retention aren't in the Developer or Reporting APIs — they live in the Play Console Statistics CSV export in Google Cloud Storage. Wire that up separately to populate those panels.",
  );

  return {
    app,
    ratings,
    reviews: reviews.slice(0, 20),
    crashes: vitalsResult.crashes,
    performance: vitalsResult.performance,
    subscriptions: subsResult.summary,
    iap: iapResult.summary,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export const googlePlayProvider: AnalyticsProvider = {
  platform: "android",
  displayName: "Google Play Console",
  isConfigured,
  listApps,
  fetchSnapshot,
};
