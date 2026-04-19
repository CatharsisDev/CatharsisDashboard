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
