"use client";

import { useMemo, useState } from "react";
import type { ScheduledPost } from "@/lib/uploadpost";
import {
  BERLIN_TZ as BERLIN,
  berlinTzLabel,
  formatBerlinDateTime,
  formatBerlinTime,
} from "@/lib/tz";

// ---- calendar math ------------------------------------------------------
type DateParts = { year: number; month: number; day: number };

function berlinParts(d: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function monthLabel(year: number, month: number) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

// Build a 6×7 grid (ISO week start = Monday) for the given month.
function buildMonthGrid(year: number, month: number) {
  // month is 1-12
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // 0 = Sunday ... 6 = Saturday. Convert to Monday-indexed 0..6
  const firstDow = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

  const cells: Array<{ year: number; month: number; day: number; inMonth: boolean }> = [];
  // leading days from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const pm = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    cells.push({ year: pm.y, month: pm.m, day: d, inMonth: false });
  }
  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, inMonth: true });
  }
  // trailing days until we hit 42
  let trailingDay = 1;
  while (cells.length < 42) {
    const nm = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    cells.push({ year: nm.y, month: nm.m, day: trailingDay++, inMonth: false });
  }
  return cells;
}

// ---- platform styling ---------------------------------------------------
const PLATFORM_TONE: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  tiktok: { dot: "#ffb3c7", text: "#ffd9e3", bg: "rgba(255, 102, 140, 0.16)", border: "rgba(255, 102, 140, 0.35)" },
  instagram: { dot: "#f7b27a", text: "#ffd7b3", bg: "rgba(247, 154, 90, 0.16)", border: "rgba(247, 154, 90, 0.35)" },
  x: { dot: "#e8dccc", text: "#f3e7d7", bg: "rgba(232, 220, 204, 0.1)", border: "rgba(232, 220, 204, 0.3)" },
  twitter: { dot: "#e8dccc", text: "#f3e7d7", bg: "rgba(232, 220, 204, 0.1)", border: "rgba(232, 220, 204, 0.3)" },
  youtube: { dot: "#e88a8a", text: "#f3c3c3", bg: "rgba(232, 138, 138, 0.14)", border: "rgba(232, 138, 138, 0.35)" },
  facebook: { dot: "#9ab6f0", text: "#d4dffc", bg: "rgba(154, 182, 240, 0.14)", border: "rgba(154, 182, 240, 0.32)" },
  linkedin: { dot: "#9ab6f0", text: "#d4dffc", bg: "rgba(154, 182, 240, 0.14)", border: "rgba(154, 182, 240, 0.32)" },
  threads: { dot: "#c9b9e3", text: "#e6d1f0", bg: "rgba(180, 137, 199, 0.14)", border: "rgba(180, 137, 199, 0.32)" },
};

function platformTone(platform: string) {
  return PLATFORM_TONE[platform.toLowerCase()] || {
    dot: "#e7b894",
    text: "#f3d9bc",
    bg: "rgba(231, 184, 148, 0.14)",
    border: "rgba(231, 184, 148, 0.3)",
  };
}

// ---- component ----------------------------------------------------------
type EventByDay = Map<string, ScheduledPost[]>;

function keyFor(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function indexEvents(posts: ScheduledPost[]): EventByDay {
  const map: EventByDay = new Map();
  for (const p of posts) {
    const d = new Date(p.scheduled_date);
    if (Number.isNaN(d.getTime())) continue;
    const bp = berlinParts(d);
    const key = keyFor(bp.year, bp.month, bp.day);
    const bucket = map.get(key) || [];
    bucket.push(p);
    map.set(key, bucket);
  }
  // sort each day's events by time
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime(),
    );
  }
  return map;
}

export default function ContentCalendar({ posts }: { posts: ScheduledPost[] }) {
  const today = useMemo(() => berlinParts(new Date()), []);
  // Default to the month with the nearest upcoming post, falling back to "today"
  const initial = useMemo(() => {
    const upcoming = posts
      .map((p) => new Date(p.scheduled_date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const now = new Date();
    const target = upcoming.find((d) => d.getTime() >= now.getTime()) || now;
    const bp = berlinParts(target);
    return { year: bp.year, month: bp.month };
  }, [posts]);
  const [cursor, setCursor] = useState(initial);

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const eventIndex = useMemo(() => indexEvents(posts), [posts]);

  const postsThisMonth = useMemo(() => {
    return posts.filter((p) => {
      const d = new Date(p.scheduled_date);
      if (Number.isNaN(d.getTime())) return false;
      const bp = berlinParts(d);
      return bp.year === cursor.year && bp.month === cursor.month;
    });
  }, [posts, cursor]);

  const goPrev = () => {
    setCursor(({ year, month }) =>
      month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    );
  };
  const goNext = () => {
    setCursor(({ year, month }) =>
      month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
    );
  };
  const goToday = () => setCursor({ year: today.year, month: today.month });

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="card-glass rounded-[2rem] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">Content calendar</div>
          <h2 className="font-display mt-2 text-3xl sm:text-4xl">
            {monthLabel(cursor.year, cursor.month)}
          </h2>
          <div className="mt-1 text-sm text-[#b9a7b6]">
            {postsThisMonth.length} scheduled · times in Europe/Berlin ({berlinTzLabel(new Date())})
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="soft-pill rounded-full px-3 py-2 text-sm text-[#f3e7d7] transition hover:bg-white/10"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            onClick={goToday}
            className="soft-pill rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#f3e7d7] transition hover:bg-white/10"
          >
            Today
          </button>
          <button
            onClick={goNext}
            className="soft-pill rounded-full px-3 py-2 text-sm text-[#f3e7d7] transition hover:bg-white/10"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-t border-l hairline overflow-hidden rounded-2xl">
        {weekdays.map((w) => (
          <div
            key={w}
            className="border-r border-b hairline bg-white/[0.02] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[#b9a7b6]"
          >
            {w}
          </div>
        ))}

        {grid.map((cell) => {
          const key = keyFor(cell.year, cell.month, cell.day);
          const events = eventIndex.get(key) || [];
          const isToday =
            cell.year === today.year && cell.month === today.month && cell.day === today.day;
          const maxShown = 3;
          const shown = events.slice(0, maxShown);
          const overflow = events.length - shown.length;

          return (
            <div
              key={`${key}-${cell.inMonth ? "in" : "out"}`}
              className={[
                "border-r border-b hairline px-2 py-2 align-top min-h-[108px] sm:min-h-[124px] flex flex-col gap-1",
                cell.inMonth ? "bg-transparent" : "bg-black/20 text-[#7a6d7a]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span
                  className={[
                    "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs",
                    isToday
                      ? "bg-[#e7b894] font-semibold text-[#2a1220]"
                      : cell.inMonth
                        ? "text-[#f3e7d7]"
                        : "text-[#7a6d7a]",
                  ].join(" ")}
                >
                  {cell.day}
                </span>
                {events.length ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#b9a7b6]">
                    {events.length} post{events.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>

              <div className="mt-1 flex flex-col gap-1">
                {shown.map((ev) => {
                  const primary = (ev.platforms && ev.platforms[0]) || ev.post_type || "post";
                  const tone = platformTone(primary);
                  const title = ev.title || ev.caption || ev.post_type || "Scheduled";
                  return (
                    <div
                      key={ev.job_id}
                      title={`${formatBerlinTime(ev.scheduled_date)} ${berlinTzLabel(new Date(ev.scheduled_date))} — ${title}`}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-tight"
                      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: tone.dot }}
                      />
                      <span className="shrink-0 font-mono text-[10px] opacity-80">
                        {formatBerlinTime(ev.scheduled_date)}
                      </span>
                      <span className="truncate">{title}</span>
                    </div>
                  );
                })}
                {overflow > 0 ? (
                  <div className="px-1 text-[10px] uppercase tracking-[0.12em] text-[#b9a7b6]">
                    + {overflow} more
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {postsThisMonth.length ? (
        <div className="mt-6">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[#b9a7b6]">
            Upcoming in {monthLabel(cursor.year, cursor.month)}
          </div>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-black/10">
            {postsThisMonth.slice(0, 6).map((p) => {
              const primary = (p.platforms && p.platforms[0]) || p.post_type || "post";
              const tone = platformTone(primary);
              return (
                <li key={p.job_id} className="flex items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
                  <span className="font-mono text-xs text-[#b9a7b6] tabular-nums">
                    {formatBerlinDateTime(p.scheduled_date)}
                  </span>
                  <span className="truncate text-sm text-[#f3e7d7]">
                    {p.title || p.caption || "Scheduled post"}
                  </span>
                  <span className="ml-auto hidden gap-1 sm:flex">
                    {(p.platforms || []).map((pl) => (
                      <span
                        key={pl}
                        className="rounded-full px-2 py-0.5 text-[10px] capitalize"
                        style={{
                          background: platformTone(pl).bg,
                          border: `1px solid ${platformTone(pl).border}`,
                          color: platformTone(pl).text,
                        }}
                      >
                        {pl}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
