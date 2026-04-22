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

export async function getTestFlightSummary(
  appId: string,
): Promise<{ summary: TestFlightSummary | null; warning?: string }> {
  try {
    const [buildsRes, groupsRes] = await Promise.all([
      ascFetchJson<{ data: Build[]; included?: PreReleaseVersion[] }>(
        `/v1/apps/${encodeURIComponent(appId)}/builds`,
        {
          query: {
            limit: 25,
            sort: "-uploadedDate",
            "fields[builds]": "version,uploadedDate,expired,processingState,preReleaseVersion",
            "fields[preReleaseVersions]": "version,platform",
            include: "preReleaseVersion",
          },
        },
      ),
      ascFetchJson<{ data: BetaGroup[] }>(
        `/v1/apps/${encodeURIComponent(appId)}/betaGroups`,
        {
          query: {
            limit: 200,
            "fields[betaGroups]": "name,isInternalGroup,betaTesters",
          },
        },
      ),
    ]);

    const prereleaseMap: Record<string, string> = {};
    for (const inc of buildsRes.included || []) {
      if (inc.type === "preReleaseVersions") {
        prereleaseMap[inc.id] = inc.attributes?.version || "";
      }
    }

    const builds: TestFlightBuild[] = (buildsRes.data || []).map((b) => {
      const prereleaseId = b.relationships?.preReleaseVersion?.data?.id;
      const appVersion = prereleaseId ? prereleaseMap[prereleaseId] : undefined;
      return {
        version: appVersion || "—",
        buildNumber: b.attributes?.version || "—",
        processingState: b.attributes?.processingState,
        uploadedDate: b.attributes?.uploadedDate,
        expired: b.attributes?.expired ?? false,
      };
    });

    let internal = 0;
    let external = 0;
    for (const g of groupsRes.data || []) {
      const count = g.relationships?.betaTesters?.meta?.paging?.total || 0;
      if (g.attributes?.isInternalGroup) internal += count;
      else external += count;
    }

    if (!builds.length && !internal && !external) {
      return { summary: null, warning: "TestFlight data not available for this app." };
    }

    return {
      summary: {
        builds,
        internalTesters: internal || undefined,
        externalTesters: external || undefined,
      },
    };
  } catch (err) {
    if (err instanceof AppStoreApiError) {
      return {
        summary: null,
        warning: `TestFlight: ${err.message.slice(0, 160)}`,
      };
    }
    throw err;
  }
}
