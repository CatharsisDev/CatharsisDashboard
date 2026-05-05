"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PERIODS,
  periodShortLabel,
  type Period,
} from "@/lib/period";

// Shared timeframe pill switcher used on /web, /app, and /. Matches the
// PlatformToggle pattern: client component that pushes ?period=<x>, preserves
// any other query params, and uses a transition so the active pill subtly
// pulses while the new server snapshot streams in.

export interface PeriodToggleProps {
  active: Period;
  /** Path the toggle navigates to (defaults to current pathname). */
  basePath: string;
}

export default function PeriodToggle({ active, basePath }: PeriodToggleProps) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setPeriod = (p: Period) => {
    if (p === active) return;
    const params = new URLSearchParams(search?.toString() || "");
    params.set("period", p);
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
    });
  };

  return (
    <div
      role="group"
      aria-label="Time window"
      className="soft-pill flex items-center gap-1 rounded-full p-1 text-xs"
    >
      {PERIODS.map((p) => {
        const isActive = active === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={isActive}
            title={`Show last ${periodShortLabel(p)}`}
            className={[
              "rounded-full px-3 py-1.5 font-mono uppercase tracking-[0.1em] tabular-nums transition",
              isActive
                ? "bg-[#e7b894] text-[#2a1220]"
                : "text-[#d9c9bc] hover:bg-white/10",
              isPending && !isActive ? "opacity-60" : "",
            ].join(" ")}
          >
            {periodShortLabel(p)}
          </button>
        );
      })}
    </div>
  );
}
