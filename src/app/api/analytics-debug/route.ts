import { NextResponse } from "next/server";
import { getAnalytics, getHistory, getPostAnalytics } from "@/lib/uploadpost";

// Diagnostic endpoint that dumps Upload-Post's raw responses for the
// profile-analytics endpoint (per-platform snapshot fields) plus one
// sample post's analytics per platform. Copy-paste the JSON output when
// numbers look wrong on the dashboard — actual field names are the
// fastest way to spot "Pinterest returns follower_count not followers"
// style mismatches.
//
// Not linked from the UI. Hit /api/analytics-debug directly in the
// browser or with curl. Returns pretty-printed JSON.

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "instagram", "x", "youtube", "pinterest"];

export async function GET() {
  try {
    // Profile-level per-platform snapshot — the source for the AnalyticsCard
    // stats (followers, impressions, etc.). If a platform is missing here or
    // has zero values, either Upload-Post isn't returning data for it or the
    // field names differ from what summarizeAnalytics expects.
    const profileAnalytics = await getAnalytics(PLATFORMS);

    // Grab one sample post per platform from history so we can see what
    // post-analytics returns — for the CSV export debugging.
    const history = await getHistory();
    const rows = history.history || [];

    const samplePosts: Record<string, unknown> = {};
    for (const platform of PLATFORMS) {
      const sample = rows.find(
        (r) => r.platform?.toLowerCase().includes(platform) && !!r.request_id,
      );
      if (sample?.request_id) {
        try {
          samplePosts[platform] = await getPostAnalytics(sample.request_id);
        } catch (err) {
          samplePosts[platform] = {
            error: err instanceof Error ? err.message : String(err),
            request_id: sample.request_id,
          };
        }
      } else {
        samplePosts[platform] = "no matching post in history";
      }
    }

    const body = {
      note:
        "Raw Upload-Post responses. Compare field names here against what summarizeAnalytics / pickViews look for. Any zero-values you see when the actual platform has data usually mean a field-name mismatch.",
      generatedAt: new Date().toISOString(),
      profileAnalytics,
      samplePosts,
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
