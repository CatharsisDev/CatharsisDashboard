import type { AppMeta } from "../types";
import { gpFetchJson, packageName } from "./client";

// The Play Developer API doesn't expose a clean "fetch app metadata" endpoint —
// it's all built around the "edits" transactional model (you create an edit,
// read fields off it, then commit or discard). Spinning up an edit just to read
// the localized title is overkill for a dashboard snapshot, so we treat the
// package name as both the id *and* the display name. The Reporting API's
// `apps/{packageName}` endpoint returns slightly richer info (display name,
// app icon URL); use it opportunistically and fall back if it 404s.

interface ReportingAppInfo {
  name?: string;
  packageName?: string;
  displayName?: string;
}

const REPORTING_BASE = "https://playdeveloperreporting.googleapis.com";

async function tryReportingAppInfo(pkg: string): Promise<ReportingAppInfo | null> {
  try {
    return await gpFetchJson<ReportingAppInfo>(`/v1beta1/apps/${encodeURIComponent(pkg)}`, {
      baseUrl: REPORTING_BASE,
    });
  } catch {
    return null;
  }
}

export async function getAppDetails(appId?: string): Promise<AppMeta | undefined> {
  const pkg = appId || packageName();
  const info = await tryReportingAppInfo(pkg);
  return {
    id: pkg,
    platform: "android" as const,
    name: info?.displayName || pkg,
    packageName: pkg,
  };
}

export async function listGooglePlayApps(): Promise<AppMeta[]> {
  // The configured package name is the only app this provider knows about.
  // Multi-app accounts could be added later by env-listing comma-separated
  // package names — for now we return exactly one.
  const pkg = packageName();
  const meta = await getAppDetails(pkg);
  return meta ? [meta] : [];
}
