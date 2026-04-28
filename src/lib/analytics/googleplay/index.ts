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

export interface GooglePlayDiagnostics {
  /** True when credentials parse cleanly. */
  configured: boolean;
  /** Env var names that are missing entirely. */
  missing: string[];
  /** Names of env vars that *are* set (just for the "we see X" hint). */
  present: string[];
  /** If JSON was supplied but failed to parse / lacked required fields. */
  parseError?: string;
}

/**
 * Inspect the running environment and report what's wrong, so the setup
 * screen can tell the user "we see GOOGLEPLAY_PACKAGE_NAME but not the JSON"
 * instead of just falling back to the generic setup page.
 */
export function inspectGooglePlayConfig(): GooglePlayDiagnostics {
  const present: string[] = [];
  const missing: string[] = [];

  const hasJson = !!process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON;
  const hasJsonB64 = !!process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64;
  const hasPkg = !!process.env.GOOGLEPLAY_PACKAGE_NAME;

  if (hasJson) present.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON");
  if (hasJsonB64) present.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64");
  if (hasPkg) present.push("GOOGLEPLAY_PACKAGE_NAME");

  if (!hasJson && !hasJsonB64) {
    missing.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64");
  }
  if (!hasPkg) missing.push("GOOGLEPLAY_PACKAGE_NAME");

  if (missing.length) {
    return { configured: false, missing, present };
  }

  try {
    const creds = loadCredentialsFromEnv();
    if (!creds) {
      return {
        configured: false,
        missing,
        present,
        parseError:
          "Credentials loader returned nothing. Double-check both env vars are non-empty.",
      };
    }
    return { configured: true, missing, present };
  } catch (err) {
    return {
      configured: false,
      missing,
      present,
      parseError: err instanceof Error ? err.message : String(err),
    };
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
