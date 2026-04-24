import { ascFetchJson, AppStoreApiError } from "./client";
import type { TestFlightBuild, TestFlightSummary } from "../types";

// TestFlight metadata comes from builds + betaGroups. The public ASC API
// doesn't expose beta tester crash counts aggregated, but we can at least
// show recent builds, their processing state, and headline tester counts.

interface BuildAttrs {
  version?: string;
  uploadedDate?: string;
  expired?: boolean;
  processingState?: string;
  usesNonExemptEncryption?: boolean;
}

interface PreReleaseVersionAttrs {
  version?: string;
  platform?: string;
}

interface BuildRelationships {
  preReleaseVersion?: { data?: { id: string; type: string } | null };
}

interface Build {
  id: string;
  type: string;
  attributes?: BuildAttrs;
  relationships?: BuildRelationships;
}

interface PreReleaseVersion {
  id: string;
  type: string;
  attributes?: PreReleaseVersionAttrs;
}

interface BetaGroupAttrs {
  name?: string;
  isInternalGroup?: boolean;
}

interface BetaGroupRelationships {
  betaTesters?: { meta?: { paging?: { total?: number } } };
}

interface BetaGroup {
  id: string;
  type: string;
  attributes?: BetaGroupAttrs;
  relationships?: BetaGroupRelationships;
}

async function fetchBuilds(appId: string): Promise<TestFlightBuild[]> {
  // Apple is fussy about which `fields[]` keys go with which include. Keep the
  // builds query minimal — no fields[]/include — and resolve the version label
  // separately for each build.
  const buildsRes = await ascFetchJson<{ data: Build[] }>(
    `/v1/apps/${encodeURIComponent(appId)}/builds`,
    {
      query: {
        limit: 25,
        sort: "-uploadedDate",
      },
    },
  );

  const builds = buildsRes.data || [];
  const prereleaseIds = Array.from(
    new Set(
      builds
        .map((b) => b.relationships?.preReleaseVersion?.data?.id)
        .filter((id): id is string => !!id),
    ),
  );

  // Resolve versions in parallel; failures fall back to "—" so one bad lookup
  // doesn't sink the whole panel.
  const versionMap: Record<string, string> = {};
  await Promise.all(
    prereleaseIds.map(async (id) => {
      try {
        const res = await ascFetchJson<{ data: PreReleaseVersion }>(
          `/v1/preReleaseVersions/${encodeURIComponent(id)}`,
        );
        versionMap[id] = res.data.attributes?.version || "";
      } catch {
        versionMap[id] = "";
      }
    }),
  );

  return builds.map((b) => {
    const prereleaseId = b.relationships?.preReleaseVersion?.data?.id;
    const appVersion = prereleaseId ? versionMap[prereleaseId] : undefined;
    return {
      version: appVersion || "—",
      buildNumber: b.attributes?.version || "—",
      processingState: b.attributes?.processingState,
      uploadedDate: b.attributes?.uploadedDate,
      expired: b.attributes?.expired ?? false,
    };
  });
}

async function countTesters(appId: string): Promise<{ internal: number; external: number }> {
  // Some keys can't see betaGroups → degrade to zero counts silently.
  try {
    const groupsRes = await ascFetchJson<{ data: BetaGroup[] }>(
      `/v1/apps/${encodeURIComponent(appId)}/betaGroups`,
      { query: { limit: 200 } },
    );

    let internal = 0;
    let external = 0;
    // The betaTesters relationship `meta.paging.total` only appears when you
    // request it explicitly. Fall back to fetching the relationship endpoint
    // for each group to get an accurate count, but cap parallelism so we
    // don't fan out to dozens of requests.
    const groups = groupsRes.data || [];
    await Promise.all(
      groups.map(async (g) => {
        let count = g.relationships?.betaTesters?.meta?.paging?.total || 0;
        if (!count) {
          try {
            const res = await ascFetchJson<{ meta?: { paging?: { total?: number } } }>(
              `/v1/betaGroups/${encodeURIComponent(g.id)}/relationships/betaTesters`,
              { query: { limit: 1 } },
            );
            count = res.meta?.paging?.total || 0;
          } catch {
            count = 0;
          }
        }
        if (g.attributes?.isInternalGroup) internal += count;
        else external += count;
      }),
    );
    return { internal, external };
  } catch {
    return { internal: 0, external: 0 };
  }
}

export async function getTestFlightSummary(
  appId: string,
): Promise<{ summary: TestFlightSummary | null; warning?: string }> {
  try {
    const [builds, testers] = await Promise.all([
      fetchBuilds(appId),
      countTesters(appId),
    ]);

    if (!builds.length && !testers.internal && !testers.external) {
      return { summary: null, warning: "TestFlight data not available for this app." };
    }

    return {
      summary: {
        builds,
        internalTesters: testers.internal || undefined,
        externalTesters: testers.external || undefined,
      },
    };
  } catch (err) {
    if (err instanceof AppStoreApiError) {
      return {
        summary: null,
        warning: `TestFlight: ${err.message.slice(0, 200)}`,
      };
    }
    throw err;
  }
}
