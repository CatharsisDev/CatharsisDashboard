"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PERIODS,
  periodLabel,
  periodShortLabel,
  type Period,
} from "@/lib/period";

// Shared timeframe pill switcher used on /web, /app, and /. Matches the
// PlatformToggle pattern: client component that pushes ?period=<x>, preserves
// any other query params, and uses a transition so the active pill subtly
// pulses while the new server snapshot streams in.
//
// We debounce navigation by ~250ms because every period click triggers a
// full server render with the upstream fan-out (GA4 runReport × N panels,
// Play Console + App Store Connect, Upload-Post). Without debouncing,
// rapid clicks like 30 → 90 → 365 fire three full rounds in parallel and
// blow through GA4's per-minute quota, ASC's per-key throttle, etc. The
// active pill snaps visually to the clicked period immediately so the UI
// stays responsive even while the actual push waits.

const DEBOUNCE_MS = 250;

export interface PeriodToggleProps {
  active: Period;
  /** Path the toggle navigates to (defaults to current pathname). */
  basePath: string;
}

export default function PeriodToggle({ active, basePath }: PeriodToggleProps) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // Local state of "what the user has clicked most recently" — drives the
  // pill highlight so the UI feels immediate. The URL push is debounced.
  const [pending, setPending] = useState<Period>(active);
  // Track the last prop value we synced to so we can re-adjust `pending` when
  // the URL changes from outside (back-button, external push). This is React's
  // recommended "adjust state on prop change" pattern done during render —
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [lastSyncedActive, setLastSyncedActive] = useState<Period>(active);
  if (active !== lastSyncedActive) {
    setLastSyncedActive(active);
    setPending(active);
  }
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any in-flight debounce if the component unmounts mid-click.
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const setPeriod = (p: Period) => {
    if (p === pending) return;
    setPending(p);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(search?.toString() || "");
      params.set("period", p);
      startTransition(() => {
        router.push(`${basePath}?${params.toString()}`);
      });
    }, DEBOUNCE_MS);
  };

  return (
    <div
      role="group"
      aria-label="Time window"
      className="soft-pill flex items-center gap-1 rounded-full p-1 text-xs"
    >
      {PERIODS.map((p) => {
        // Active pill = the period the user most recently clicked (drives
        // visual feedback even while the navigation is debounced). isLoaded
        // = whether that period has actually been pushed to the URL yet.
        const isActive = pending === p;
        const isLoaded = active === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={isActive}
            title={`Show ${periodLabel(p)}`}
            className={[
              "rounded-full px-3 py-1.5 font-mono uppercase tracking-[0.1em] tabular-nums transition",
              isActive
                ? "bg-[#e7b894] text-[#2a1220]"
                : "text-[#d9c9bc] hover:bg-white/10",
              // Subtle dimming while we're either debouncing or the new
              // server render is in flight — tells the user "we heard you,
              // hold on" without blocking further clicks.
              (isPending || !isLoaded) && isActive ? "opacity-80" : "",
            ].join(" ")}
          >
            {periodShortLabel(p)}
          </button>
        );
      })}
    </div>
  );
}
