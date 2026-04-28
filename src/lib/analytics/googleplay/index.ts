import type { AnalyticsProvider, AppMeta, AppSnapshot } from "../types";
import { loadCredentialsFromEnv } from "./credentials";
import { getAppDetails, listGooglePlayApps } from "./apps";
import { listCustomerReviews, summarizeRatings } from "./reviews";
import { getIapCatalog, getSubscriptionCatalog } from "./monetization";
import { getVitals } from "./vitals";
import { getDevices, getInstallsTimeSeries, getTerritories } from "./stats-installs";
import { getFinanceFromExport } from "./stats-finance";

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
  const hasBucket = !!process.env.GOOGLEPLAY_STATS_BUCKET;

  const hasUserOAuth =
    !!process.env.GOOGLEPLAY_USER_OAUTH_JSON ||
    !!process.env.GOOGLEPLAY_USER_OAUTH_JSON_BASE64;

  if (hasJson) present.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON");
  if (hasJsonB64) present.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64");
  if (hasPkg) present.push("GOOGLEPLAY_PACKAGE_NAME");
  if (hasBucket) present.push("GOOGLEPLAY_STATS_BUCKET");
  if (hasUserOAuth) {
    present.push(
      process.env.GOOGLEPLAY_USER_OAUTH_JSON_BASE64
        ? "GOOGLEPLAY_USER_OAUTH_JSON_BASE64"
        : "GOOGLEPLAY_USER_OAUTH_JSON",
    );
  }

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

  // The Statistics / Financial CSV bucket is opt-in. Without it we still
  // surface reviews + vitals + monetization catalog, but installs / revenue /
  // territories / devices stay empty.
  const creds = (() => {
    try {
      return loadCredentialsFromEnv();
    } catch {
      return null;
    }
  })();
  const bucket = creds?.statsBucket;

  // Kick every independent fetcher off in parallel. Each one degrades
  // gracefully — a failure appends a warning instead of collapsing the page.
  const [
    reviews,
    iapResult,
    subsResult,
    vitalsResult,
    installs,
    territories,
    devices,
    finance,
  ] = await Promise.all([
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
    bucket
      ? getInstallsTimeSeries(bucket, appId).catch((err) => {
          warnings.push(
            `Could not read installs CSV: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return undefined;
        })
      : Promise.resolve(undefined),
    bucket
      ? getTerritories(bucket, appId).catch((err) => {
          warnings.push(
            `Could not read country CSV: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return undefined;
        })
      : Promise.resolve(undefined),
    bucket
      ? getDevices(bucket, appId).catch((err) => {
          warnings.push(
            `Could not read device CSV: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return undefined;
        })
      : Promise.resolve(undefined),
    bucket
      ? getFinanceFromExport(bucket, appId).catch((err) => {
          warnings.push(
            `Could not read earnings CSV: ${err instanceof Error ? err.message : "unknown"}`,
          );
          return undefined;
        })
      : Promise.resolve(undefined),
  ]);

  const ratings = summarizeRatings(reviews);
  if (iapResult.warning) warnings.push(iapResult.warning);
  if (subsResult.warning) warnings.push(subsResult.warning);
  if (vitalsResult.warning) warnings.push(vitalsResult.warning);

  if (!bucket) {
    warnings.push(
      "Set GOOGLEPLAY_STATS_BUCKET (the gs:// URI from Play Console → Download reports) to fill installs, revenue, territories and devices. The empty panels below explain where each one comes from.",
    );
  } else if (!installs && !territories && !devices && !finance) {
    warnings.push(
      `Stats bucket (${bucket}) is configured but no CSVs landed in the trailing 30-day window for ${appId}. New buckets take ~24h to receive their first export, and the service account needs the "Storage Object Viewer" role on this bucket.`,
    );
  }

  return {
    app,
    ratings,
    reviews: reviews.slice(0, 20),
    installs,
    crashes: vitalsResult.crashes,
    performance: vitalsResult.performance,
    finance,
    territories,
    devices,
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
