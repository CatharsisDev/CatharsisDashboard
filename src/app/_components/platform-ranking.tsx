"use client";

import { useMemo, useState } from "react";
import type { AnalyticsMetric } from "@/lib/uploadpost";
import InfoTooltip from "./info-tooltip";

// Leaderboard widget shown on the homepage — compares every connected
// platform against the others by Impressions, Engagement, Reach, or
// Engagement Rate. Each tab re-sorts the same dataset client-side (no
// refetch). The relative bar under each row visualizes share of the
// leader, so "Pinterest is at 30% of TikTok's impressions" is obvious
// without doing math.

type RankKey = "impressions" | "engagement" | "reach" | "rate";

const TABS: { key: RankKey; label: string; info: string }[] = [
  {
    key: "impressions",
    label: "Impressions",
    info: "Times your content rendered, summed across the platform's API window. Note: each platform defines impressions differently (see the per-platform card tooltips below) — this ranking treats whatever each platform returns as comparable, even though the windows and inclusion rules differ.",
  },
  {
    key: "engagement",
    label: "Engagement",
    info: "Sum of likes + comments + shares + saves per platform. A volume measure: a platform with lots of impressions and few engagements still ranks high here. Compare with the Rate tab to see whether the engagement is proportional.",
  },
  {
    key: "reach",
    label: "Reach",
    info: "Unique accounts that saw your content at least once. Reach ≤ Impressions because a single account can be impressed multiple times. Platforms that don't expose reach via API show as 0 here and rank last.",
  },
  {
    key: "rate",
    label: "Engagement rate",
    info: "Engagement ÷ Impressions. The 'quality' metric — high impressions with low rate means the platform shows your content widely but viewers don't interact. Rate is the most cross-platform-comparable number on this leaderboard because both halves come from the same platform's accounting.",
  },
];

// Mirrors the calendar's PLATFORM_TONE palette so the leaderboard reads as a
// natural continuation of the visual language already on the page.
const PLATFORM_PALETTE: Record<string, { color: string; label: string }> = {
  tiktok: { color: "#ffb3c7", label: "TikTok" },
  instagram: { color: "#f7b27a", label: "Instagram" },
  x: { color: "#e8dccc", label: "X" },
  twitter: { color: "#e8dccc", label: "Twitter" },
  youtube: { color: "#e88a8a", label: "YouTube" },
  pinterest: { color: "#e2585c", label: "Pinterest" },
  facebook: { color: "#9ab6f0", label: "Facebook" },
  linkedin: { color: "#9ab6f0", label: "LinkedIn" },
  threads: { color: "#c9b9e3", label: "Threads" },
};

function paletteFor(platform: string): { color: string; label: string } {
  const k = platform.toLowerCase();
  return (
    PLATFORM_PALETTE[k] || {
      color: "#e7b894",
      label: platform.charAt(0).toUpperCase() + platform.slice(1),
    }
  );
}

interface Ranked {
  platform: string;
  label: string;
  color: string;
  value: number;
  displayValue: string;
  /** 0..1, share of the leader's value — drives the bar width. */
  share: number;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(Math.round(value));
}

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * For each platform, compute the metric requested by the current tab and
 * sort descending. Engagement and Rate are derived; Impressions/Reach come
 * straight from the platform's API response.
 */
function rank(analytics: AnalyticsMetric[], key: RankKey): Ranked[] {
  const rows = analytics.map((m) => {
    const impressions = Number(m.impressions || m.views || 0);
    const reach = Number(m.reach || 0);
    const engagement =
      Number(m.likes || 0) +
      Number(m.comments || 0) +
      Number(m.shares || 0) +
      Number(m.saves || 0);

    let value = 0;
    let displayValue = "—";
    switch (key) {
      case "impressions":
        value = impressions;
        displayValue = formatNumber(impressions);
        break;
      case "engagement":
        value = engagement;
        displayValue = formatNumber(engagement);
        break;
      case "reach":
        value = reach;
        displayValue = formatNumber(reach);
        break;
      case "rate":
        value = impressions > 0 ? engagement / impressions : 0;
        displayValue = impressions > 0 ? formatPercent(value) : "—";
        break;
    }

    const palette = paletteFor(m.platform);
    return {
      platform: m.platform,
      label: palette.label,
      color: palette.color,
      value,
      displayValue,
    };
  });

  rows.sort((a, b) => b.value - a.value);

  // Bar widths are share of the leader so the #1 platform always has a full
  // bar. We compute max from the sorted list directly.
  const max = rows[0]?.value ?? 0;
  return rows.map((r) => ({
    ...r,
    share: max > 0 ? r.value / max : 0,
  }));
}

export default function PlatformRanking({ analytics }: { analytics: AnalyticsMetric[] }) {
  const [active, setActive] = useState<RankKey>("impressions");
  const rows = useMemo(() => rank(analytics, active), [analytics, active]);

  if (!analytics.length) {
    return null;
  }

  const activeTab = TABS.find((t) => t.key === active);
  const hasAnyData = rows.some((r) => r.value > 0);

  return (
    <section className="card-glass rounded-[2rem] p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">
            Leaderboard
          </div>
          <h2 className="font-display mt-2 text-3xl sm:text-4xl">Platform ranking</h2>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Rank platforms by"
            className="soft-pill flex flex-wrap items-center gap-1 rounded-full p-1 text-xs"
          >
            {TABS.map((t) => {
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => setActive(t.key)}
                  className={[
                    "rounded-full px-3 py-1.5 uppercase tracking-[0.14em] transition",
                    isActive
                      ? "bg-[#e7b894] text-[#2a1220]"
                      : "text-[#d9c9bc] hover:bg-white/10",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {activeTab ? <InfoTooltip text={activeTab.info} position="left" /> : null}
        </div>
      </div>

      {hasAnyData ? (
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li
              key={r.platform}
              className="rounded-2xl border border-white/5 bg-black/15 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-[#e7b894]/70">
                  #{i + 1}
                </span>
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: r.color }}
                />
                <span className="font-display text-lg text-[#f3e7d7]">{r.label}</span>
                <span className="ml-auto font-mono tabular-nums text-[#fff3e0]">
                  {r.displayValue}
                </span>
              </div>
              {/* Relative-share bar — the #1 platform fills 100%, others fill
                  their value as a fraction of #1. Empty platforms show no
                  fill so the row degrades silently to a thin track. */}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, r.share * 100)}%`,
                    background: r.color,
                    opacity: r.value > 0 ? 0.85 : 0,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[#b9a7b6]">
          No {activeTab?.label.toLowerCase()} data yet on any connected platform.
        </div>
      )}
    </section>
  );
}
