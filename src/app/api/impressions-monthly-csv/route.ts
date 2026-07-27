import { NextResponse } from "next/server";
import {
  getHistory,
  getPostAnalytics,
  normalizeHistory,
  type PostAnalyticsResponse,
} from "@/lib/uploadpost";

// Rebuilds the "Views on recent uploads" headline number as a monthly
// breakdown per platform, so the user can see how the aggregate is
// composed. Fetches history → dedupes by request_id → pulls per-post
// analytics with a small concurrency limit → buckets by YYYY-MM +
// platform → streams back a CSV attachment.
//
// The CSV downloads with a timestamped filename so multiple exports
// don't overwrite each other on disk.

// GET /api/impressions-monthly-csv
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel-friendly ceiling — up to 5 min for many posts.

const CONCURRENCY = 5;

/**
 * Views-metric extraction. Upload-Post's per-post response shape drifts by
 * platform — TikTok uses `views`, Meta uses `impressions`, YouTube uses
 * `view_count`, Pinterest uses `impression_count`, X uses `impression_count`
 * with recent API changes. We check every candidate field and return the
 * largest positive number so a present-but-zero synonym never shadows a
 * populated one further down the list.
 */
function pickViews(metrics: Record<string, number> | undefined): number {
  if (!metrics) return 0;
  const candidates = [
    "views",
    "view_count",
    "impressions",
    "impression_count",
    "total_views",
    "plays",
    "play_count",
    "pin_impressions",
    "reach",
  ];
  let best = 0;
  for (const k of candidates) {
    const raw = metrics[k];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/**
 * Convert an ISO/epoch-ish timestamp into YYYY-MM. Falls back to
 * "unknown-month" for rows Upload-Post returned without a timestamp — we
 * still include them so the total matches your headline number.
 */
function monthKey(ts: string | undefined): string {
  if (!ts) return "unknown-month";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "unknown-month";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Simple concurrency-limited Promise.all — avoids hammering Upload-Post. */
async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

interface Row {
  month: string;
  platform: string;
  postCount: number;
  totalViews: number;
}

function toCsv(
  rows: Row[],
  meta: {
    generatedAt: string;
    totalPosts: number;
    totalViews: number;
    failedFetches: number;
    postsWithZeroViews: number;
    seenMetricFields: string[];
  },
): string {
  const header = "Month,Platform,Post count,Total views";
  const body = rows
    .map((r) => [r.month, r.platform, r.postCount, r.totalViews].join(","))
    .join("\n");
  // Trailing metadata block. The seenMetricFields dump makes it obvious when
  // Upload-Post is returning a field name our picker isn't recognizing —
  // e.g. if you see 'playCount' or 'view_count' in the list but the totals
  // are still low, that's the field to add to the picker.
  const footer = [
    "",
    `# Generated: ${meta.generatedAt}`,
    `# Total posts fetched successfully: ${meta.totalPosts}`,
    `# Posts with 0 detected views: ${meta.postsWithZeroViews} (these had no field matching our picker — see next line)`,
    `# Failed post-analytics fetches: ${meta.failedFetches} (rate-limited, deleted, or auth-expired)`,
    `# Total lifetime views detected: ${meta.totalViews}`,
    `# Fields observed across all posts' post_metrics: ${meta.seenMetricFields.join(", ") || "(none)"}`,
    "# Definition: 'Total views' = current lifetime view count of every post",
    "#             published in the month, summed. If this doesn't match the",
    "#             headline 'Views on recent uploads' card, compare the",
    "#             'Fields observed' list above with the picker's field list",
    "#             in src/app/api/impressions-monthly-csv/route.ts — likely a",
    "#             field name mismatch.",
  ].join("\n");
  return `${header}\n${body}\n${footer}\n`;
}

export async function GET() {
  try {
    const history = normalizeHistory(await getHistory());

    // Dedupe by request_id — a multi-platform post creates one history row
    // per destination, but only one request_id and one post-analytics fetch.
    const uniqueRequestIds = Array.from(
      new Set(history.map((h) => h.request_id).filter((x): x is string => !!x)),
    );

    if (!uniqueRequestIds.length) {
      return new NextResponse("Month,Platform,Post count,Total views\n# No posts found in Upload-Post history.\n", {
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    // Pull per-post analytics with limited concurrency. Any single post that
    // fails to fetch (rate limit, deleted post, expired auth) is skipped —
    // its absence is preferable to a hard error for the whole export.
    const analytics = await mapWithConcurrency(uniqueRequestIds, CONCURRENCY, async (id) => {
      try {
        return await getPostAnalytics(id);
      } catch {
        return null;
      }
    });

    // Bucket month → platform → { count, views }.
    const buckets = new Map<string, Map<string, { count: number; views: number }>>();

    // Build a fast lookup so we can find upload_timestamp per request_id
    // from the history (post-analytics also returns it, but history's is
    // more reliable — post-analytics sometimes strips it on old posts).
    const timestampByRequestId = new Map<string, string | undefined>();
    for (const h of history) {
      if (h.request_id && !timestampByRequestId.has(h.request_id)) {
        timestampByRequestId.set(h.request_id, h.upload_timestamp);
      }
    }

    let totalViews = 0;
    let totalPosts = 0;
    let failedFetches = 0;
    let postsWithZeroViews = 0;
    // Track every distinct field name Upload-Post actually returned across
    // any post's per-platform metrics — surfaces field names our picker
    // might be missing so the user can tell us what to add.
    const seenMetricFields = new Set<string>();

    for (const [i, id] of uniqueRequestIds.entries()) {
      const ana = analytics[i] as PostAnalyticsResponse | null;
      if (!ana) {
        failedFetches += 1;
        continue;
      }
      const ts = ana.post?.upload_timestamp || timestampByRequestId.get(id);
      const month = monthKey(ts);
      totalPosts += 1;

      // Iterate each platform this post landed on — each gets its own row
      // in the CSV since a post on 5 platforms contributes to 5 platform
      // rows for its month.
      const perPlatform = ana.platforms || {};
      let anyViewsThisPost = false;
      for (const [platform, data] of Object.entries(perPlatform)) {
        // Record every field name we see, so the CSV footer can list them
        // for the user to compare against our picker's expected names.
        for (const field of Object.keys(data.post_metrics || {})) {
          seenMetricFields.add(field);
        }

        const views = pickViews(data.post_metrics);

        // Even zero-view rows land in the bucket now (as 0) — that way a
        // post the picker couldn't score shows up as a row with 0 rather
        // than silently vanishing. The postsWithZeroViews counter in the
        // footer makes the gap between "fetched" and "counted" visible.
        let monthMap = buckets.get(month);
        if (!monthMap) {
          monthMap = new Map();
          buckets.set(month, monthMap);
        }
        const key = platform.toLowerCase();
        const cur = monthMap.get(key) || { count: 0, views: 0 };
        cur.count += 1;
        cur.views += views;
        monthMap.set(key, cur);

        if (views > 0) {
          totalViews += views;
          anyViewsThisPost = true;
        }
      }
      if (!anyViewsThisPost) postsWithZeroViews += 1;
    }

    // Flatten to rows, sorted newest-month-first, then platform alphabetical.
    const rows: Row[] = [];
    const sortedMonths = Array.from(buckets.keys()).sort((a, b) => (a < b ? 1 : -1));
    for (const month of sortedMonths) {
      const monthMap = buckets.get(month)!;
      const platforms = Array.from(monthMap.keys()).sort();
      for (const platform of platforms) {
        const { count, views } = monthMap.get(platform)!;
        rows.push({
          month,
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          postCount: count,
          totalViews: views,
        });
      }
    }

    const csv = toCsv(rows, {
      generatedAt: new Date().toISOString(),
      totalPosts,
      totalViews,
      failedFetches,
      postsWithZeroViews,
      seenMetricFields: Array.from(seenMetricFields).sort(),
    });

    // Filename includes today's date so repeated downloads don't collide.
    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catharsis-monthly-views-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new NextResponse(`# Error generating CSV: ${msg}\n`, {
      status: 500,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }
}
