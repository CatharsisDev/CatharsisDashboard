"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// The platform toggle is rendered inside the server page's header. Clicking a
// pill pushes `?platform=ios|android` and calls router.refresh() via a
// transition — same pattern as the calendar refresh button, so the switch
// feels instant and the pending pill gets a subtle pulse while the new
// snapshot streams in from the server.

type Platform = "ios" | "android";

export interface PlatformToggleProps {
  active: Platform;
  iosConfigured: boolean;
  androidConfigured: boolean;
}

const OPTIONS: Array<{ key: Platform; label: string; shortLabel: string }> = [
  { key: "ios", label: "App Store", shortLabel: "iOS" },
  { key: "android", label: "Google Play", shortLabel: "Android" },
];

export default function PlatformToggle({
  active,
  iosConfigured,
  androidConfigured,
}: PlatformToggleProps) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const configured: Record<Platform, boolean> = {
    ios: iosConfigured,
    android: androidConfigured,
  };

  const setPlatform = (p: Platform) => {
    if (p === active) return;
    // Preserve any other query params the user might have on the page.
    const params = new URLSearchParams(search?.toString() || "");
    params.set("platform", p);
    startTransition(() => {
      router.push(`/app?${params.toString()}`);
    });
  };

  return (
    <div
      role="group"
      aria-label="App platform"
      className="soft-pill flex items-center gap-1 rounded-full p-1 text-xs"
    >
      {OPTIONS.map((o) => {
        const isActive = active === o.key;
        const isConfigured = configured[o.key];
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setPlatform(o.key)}
            aria-pressed={isActive}
            title={
              isConfigured
                ? `Show ${o.label} metrics`
                : `${o.label} isn't configured yet — clicking shows setup instructions`
            }
            className={[
              "relative rounded-full px-3 py-1.5 uppercase tracking-[0.18em] transition",
              isActive
                ? "bg-[#e7b894] text-[#2a1220]"
                : "text-[#d9c9bc] hover:bg-white/10",
              isPending && !isActive ? "opacity-60" : "",
            ].join(" ")}
          >
            <span className="mr-1.5 hidden sm:inline">{o.label}</span>
            <span className="sm:hidden">{o.shortLabel}</span>
            {/* Small dot indicates configuration state; active pill uses dark dot */}
            <span
              aria-hidden
              className={[
                "inline-block h-1.5 w-1.5 rounded-full align-middle",
                isConfigured
                  ? isActive
                    ? "bg-[#2a1220]"
                    : "bg-[#9cd49c]"
                  : "bg-[#8f7d8c]",
              ].join(" ")}
            />
          </button>
        );
      })}
    </div>
  );
}
