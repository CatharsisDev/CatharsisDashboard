"use client";

import { useState, type ReactNode } from "react";

// Tab IDs are part of the URL hash so a deep-link survives a refresh and the
// in-page anchor scrolls correctly. The server component does the data fetch
// and renders every tab's content as a slot prop — this client wrapper just
// switches which one is visible.
export type TabKey = "overview" | "revenue" | "acquisition" | "engagement" | "quality";

interface TabDef {
  key: TabKey;
  label: string;
  hint?: string;
}

const TABS: TabDef[] = [
  { key: "overview", label: "Overview", hint: "ratings · installs · reviews" },
  { key: "revenue", label: "Revenue", hint: "sales · IAP · subs" },
  { key: "acquisition", label: "Acquisition", hint: "funnel · sources · search · geo" },
  { key: "engagement", label: "Engagement", hint: "active · retention · versions" },
  { key: "quality", label: "Quality", hint: "perf · TestFlight" },
];

export interface DashboardTabsProps {
  overview: ReactNode;
  revenue: ReactNode;
  acquisition: ReactNode;
  engagement: ReactNode;
  quality: ReactNode;
}

export default function DashboardTabs(props: DashboardTabsProps) {
  const [active, setActive] = useState<TabKey>("overview");
  const slot = props[active];

  return (
    <div className="flex flex-col gap-6">
      <nav
        role="tablist"
        aria-label="App Store metrics sections"
        className="card-glass flex flex-wrap items-center gap-1 rounded-2xl p-1.5"
      >
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.key}`}
              onClick={() => setActive(t.key)}
              className={[
                "group flex flex-1 min-w-[140px] flex-col items-start gap-0.5 rounded-xl px-4 py-2.5 text-left transition",
                isActive
                  ? "bg-[#e7b894] text-[#2a1220]"
                  : "text-[#d9c9bc] hover:bg-white/5 hover:text-[#f3e7d7]",
              ].join(" ")}
            >
              <span
                className={[
                  "text-[11px] font-semibold uppercase tracking-[0.18em]",
                  isActive ? "text-[#2a1220]" : "text-[#f3e7d7]",
                ].join(" ")}
              >
                {t.label}
              </span>
              {t.hint ? (
                <span
                  className={[
                    "text-[10px]",
                    isActive ? "text-[#6b3f33]" : "text-[#8f7d8c] group-hover:text-[#b9a7b6]",
                  ].join(" ")}
                >
                  {t.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id={`tabpanel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="flex flex-col gap-10"
      >
        {slot}
      </div>
    </div>
  );
}
