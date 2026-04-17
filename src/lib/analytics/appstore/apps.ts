import { ascFetchAll, ascFetchJson } from "./client";
import type { AppMeta } from "../types";

interface AscAppAttributes {
  name?: string;
  bundleId?: string;
  primaryLocale?: string;
  subtitle?: string;
}

interface AscApp {
  type: "apps";
  id: string;
  attributes?: AscAppAttributes;
  relationships?: {
    appInfos?: { data?: { id: string; type: string }[] };
  };
}

export async function listAppStoreApps(): Promise<AppMeta[]> {
  const apps = await ascFetchAll<AscApp>("/v1/apps", {
    query: { limit: 200 },
    maxPages: 3,
  });
  return apps.map((a) => ({
    id: a.id,
    platform: "ios" as const,
    name: a.attributes?.name || "Unnamed app",
    bundleId: a.attributes?.bundleId,
    primaryLocale: a.attributes?.primaryLocale,
    subtitle: a.attributes?.subtitle,
  }));
}

interface AscAppInfoAttributes {
  primaryLocale?: string;
  subtitle?: string;
  name?: string;
  promotionalText?: string;
  appStoreAgeRating?: string;
}
interface AscAppInfoResponse {
  data: {
    attributes?: AscAppInfoAttributes;
  };
}

interface AppIconResponse {
  data?: Array<{
    attributes?: {
      imageAsset?: {
        templateUrl?: string;
        width?: number;
        height?: number;
      };
    };
  }>;
}

/** Best-effort icon resolution. ASC exposes icons via appInfoLocalizations. */
export async function getAppIconUrl(appId: string): Promise<string | undefined> {
  try {
    const info = await ascFetchJson<AppIconResponse>(`/v1/apps/${encodeURIComponent(appId)}/appInfos`, {
      query: { limit: 1, "fields[appInfos]": "appStoreState" },
    });
    // Apple's API for the app icon asset is buried under a chain of relationships
    // that vary by app state. Rather than walking them, we just skip icons if not
    // easy to get; the UI handles missing icons gracefully.
    void info;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function getAppDetails(appId: string): Promise<AppMeta | null> {
  try {
    const res = await ascFetchJson<{ data: AscApp }>(`/v1/apps/${encodeURIComponent(appId)}`);
    const a = res.data;
    return {
      id: a.id,
      platform: "ios" as const,
      name: a.attributes?.name || "Unnamed app",
      bundleId: a.attributes?.bundleId,
      primaryLocale: a.attributes?.primaryLocale,
      subtitle: a.attributes?.subtitle,
    };
  } catch {
    return null;
  }
}
