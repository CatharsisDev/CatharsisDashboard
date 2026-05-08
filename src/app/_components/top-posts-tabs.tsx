"use client";

import { useState } from "react";
import { berlinTzLabel, formatBerlinDateTime } from "@/lib/tz";
import type {
  TopPost,
  TopPostSortKey,
  TopPostsRankings,
} from "../page-types";

// Tab labels follow the same ordering as the data tabs in /web (most-asked
// first). Each tab swaps the active list client-side; data is computed
// server-side once per request and passed in as props.

const TABS: { key: TopPostSortKey; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "engagement", label: "Engagement" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(Math.round(value));
}

function formatDate(value?: string): string {
  return formatBerlinDateTime(value);
}

/**
 * Render the value of `key` on `post`. Centralized so both the headline
 * stat box and the platform pills agree on which number is "the" metric
 * for the active tab.
 */
function metricValue(post: TopPost, key: TopPostSortKey): number {
  switch (key) {
    case "views":
      return post.totalViews;
    case "likes":
      return post.totalLikes;
    case "comments":
      return post.totalComments;
    case "engagement":
      return post.totalEngagement;
  }
}

function metricLabel(key: TopPostSortKey): string {
  switch (key) {
    case "views":
      return "Views";
    case "likes":
      return "Likes";
    case "comments":
      return "Comments";
    case "engagement":
      return "Engagement";
  }
}

/**
 * Per-platform metric pills. `key` decides which number to surface — for
 * "engagement" we sum likes+comments+shares+saves on that platform; for
 * the simple metrics we just look up the synonym set.
 */
function platformMetric(
  metrics: Record<string, number> | undefined,
  key: TopPostSortKey,
): number {
  if (!metrics) return 0;
  const m = (...keys: string[]): number => {
    let v = 0;
    for (const k of keys) {
      const candidate = Number(metrics[k] || 0);
      if (candidate > v) v = candidate;
    }
    return v;
  };
  switch (key) {
    case "views":
      return m("views", "impressions", "reach");
    case "likes":
      return m("likes", "favorites", "reactions");
    case "comments":
      return m("comments", "replies");
    case "engagement":
      return (
        m("likes", "favorites", "reactions") +
        m("comments", "replies") +
        m("shares", "reposts", "retweets") +
        m("saves", "bookmarks")
      );
  }
}

export default function TopPostsTabs({
  rankings,
}: {
  rankings: TopPostsRankings;
}) {
  const [active, setActive] = useState<TopPostSortKey>("views");
  const list = rankings[active];

  const totalsAcrossKeys =
    rankings.views.length +
    rankings.likes.length +
    rankings.comments.length +
    rankings.engagement.length;
  if (totalsAcrossKeys === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[#b9a7b6]">
        No post analytics available yet.
      </div>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Rank top posts by"
          className="soft-pill flex items-center gap-1 rounded-full p-1 text-xs"
        >
          {TABS.map((t) => {
            const isActive = active === t.key;
            const populated = rankings[t.key].length > 0;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setActive(t.key)}
                disabled={!populated}
                title={populated ? `Sort top posts by ${t.label.toLowerCase()}` : `No ${t.label.toLowerCase()} data yet`}
                className={[
                  "rounded-full px-3 py-1.5 uppercase tracking-[0.16em] transition",
                  isActive
                    ? "bg-[#e7b894] text-[#2a1220]"
                    : populated
                      ? "text-[#d9c9bc] hover:bg-white/10"
                      : "text-[#5e4a4a] cursor-not-allowed",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
          ranking by {metricLabel(active).toLowerCase()}
        </span>
      </div>

      {list.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((post, idx) => (
            <article
              key={post.requestId}
              className="rounded-3xl border border-white/5 bg-black/15 p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#b489c7]">
                  {post.mediaType}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-[#e7b894]/70">
                  #{idx + 1}
                </div>
              </div>
              <h3 className="font-display mt-2 text-xl text-[#f3e7d7]">{post.title}</h3>
              <div className="mt-2 font-mono text-xs tabular-nums text-[#b9a7b6]">
                {formatDate(post.uploadedAt)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <PrimaryStatBox
                  label={metricLabel(active)}
                  value={metricValue(post, active)}
                />
                {/* Always pair the active metric with one complementary number
                    so the card carries context. Engagement gets paired with
                    views; everything else gets paired with engagement. */}
                <SecondaryStatBox
                  label={active === "engagement" ? "Views" : "Engagement"}
                  value={
                    active === "engagement" ? post.totalViews : post.totalEngagement
                  }
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#d9c9bc]">
                {post.platforms.map(([platform, data]) => (
                  <span
                    key={platform}
                    className="soft-pill rounded-full px-3 py-1 capitalize"
                  >
                    {platform}: {formatNumber(platformMetric(data.post_metrics, active))}
                  </span>
                ))}
              </div>
              <div className="mt-3 font-mono text-[10px] text-[#8f7d8c]">
                req · {post.requestId}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[#b9a7b6]">
          No posts have any {metricLabel(active).toLowerCase()} data yet.
        </div>
      )}
      <div className="mt-3 text-[10px] text-[#8f7d8c]">
        Times in {berlinTzLabel(new Date())}.
      </div>
    </>
  );
}

function PrimaryStatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#e7b894]/30 bg-[#e7b894]/10 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#f3d9bc]">{label}</div>
      <div className="mt-2 font-display text-3xl text-[#fff3e0]">{formatNumber(value)}</div>
    </div>
  );
}

function SecondaryStatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">
        {formatNumber(value)}
      </div>
    </div>
  );
}
