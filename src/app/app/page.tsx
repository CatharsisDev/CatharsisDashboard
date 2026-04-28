import Link from "next/link";
import DashboardTabs from "./dashboard-tabs";
import PlatformToggle from "./platform-toggle";
import { getProvider } from "@/lib/analytics";
import { inspectGooglePlayConfig } from "@/lib/analytics/googleplay";
import type { Platform } from "@/lib/analytics/types";
import type {
  ActiveDevicesSummary,
  AppMeta,
  AppSnapshot,
  AppVersionStat,
  DeviceStat,
  FinanceSummary,
  FunnelSummary,
  IapSummary,
  MoneyAmount,
  PerformanceMetric,
  RatingsSummary,
  RetentionCohort,
  Review,
  SearchTermStat,
  SourceStat,
  SubscriptionsSummary,
  TerritoryStat,
  TestFlightSummary,
  TimeSeriesStats,
} from "@/lib/analytics/types";
import { berlinTzLabel, formatBerlinDateTime } from "@/lib/tz";

export const dynamic = "force-dynamic";

// ---- formatting helpers -------------------------------------------------
function formatNumber(v: number) {
  return new Intl.NumberFormat("en-GB").format(Math.round(v));
}

function formatPercent(v: number | undefined, digits = 1) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function formatMoney(m: MoneyAmount | undefined): string {
  if (!m || !Number.isFinite(m.amount)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: Math.abs(m.amount) < 100 ? 2 : 0,
    }).format(m.amount);
  } catch {
    return `${m.amount.toFixed(2)} ${m.currency}`;
  }
}

function formatReviewDate(value: string) {
  return formatBerlinDateTime(value);
}

function Stars({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const fullStars = Math.round(value);
  const px = size === "sm" ? "text-[12px]" : "text-[18px]";
  return (
    <span className={`font-mono ${px} text-[#e7b894]`} aria-label={`${value.toFixed(1)} out of 5`}>
      {"★".repeat(Math.min(5, Math.max(0, fullStars)))}
      <span className="text-[#5e4a4a]">{"★".repeat(Math.max(0, 5 - fullStars))}</span>
    </span>
  );
}

// ---- tiles --------------------------------------------------------------
function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[#8f7d8c]">{sub}</div> : null}
    </div>
  );
}

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-white/5 pb-2">
      <h2 className="font-display text-2xl text-[#f3e7d7]">{title}</h2>
      {note ? <span className="text-[10px] uppercase tracking-[0.2em] text-[#8f7d8c]">{note}</span> : null}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 text-sm text-[#b9a7b6]">{children}</div>;
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="card-glass rounded-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">{title}</div>
        {note ? <span className="text-[10px] text-[#8f7d8c]">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

// ---- charts -------------------------------------------------------------
function InstallsChart({ data }: { data: TimeSeriesStats }) {
  const max = Math.max(1, ...data.points.map((p) => p.value));
  const BAR_W = 28;
  const BAR_GAP = 10;
  const CHART_H = 140;
  const width = data.points.length * (BAR_W + BAR_GAP);
  return (
    <div className="overflow-x-auto cathars-scroll">
      <svg width={width} height={CHART_H + 30} role="img" aria-label="Daily installs">
        {data.points.map((p, i) => {
          const h = (p.value / max) * CHART_H;
          const x = i * (BAR_W + BAR_GAP);
          const y = CHART_H - h;
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={BAR_W}
                height={h}
                rx={6}
                fill="url(#emberGrad)"
                opacity={p.value === 0 ? 0.35 : 1}
              />
              <text
                x={x + BAR_W / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#d9c9bc"
                fontFamily="monospace"
              >
                {p.value}
              </text>
              <text
                x={x + BAR_W / 2}
                y={CHART_H + 18}
                textAnchor="middle"
                fontSize="9"
                fill="#8f7d8c"
                fontFamily="monospace"
              >
                {p.date.slice(5)}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="emberGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#e7b894" />
            <stop offset="100%" stopColor="#b489c7" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function ShareBar({
  label,
  value,
  total,
  hint,
}: {
  label: string;
  value: number;
  total: number;
  hint?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="mb-1 flex items-center gap-2 text-xs text-[#d9c9bc]">
      <span className="w-32 truncate" title={label}>
        {label}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: "linear-gradient(90deg, #e7b894, #b489c7)",
          }}
        />
      </div>
      <span className="w-14 text-right font-mono tabular-nums text-[#b9a7b6]">
        {hint ?? formatNumber(value)}
      </span>
    </div>
  );
}

// ---- header + overview --------------------------------------------------
function AppHeader({ app, platformName }: { app: AppMeta; platformName: string }) {
  const initial = app.name.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-5">
      <div className="card-ember flex h-20 w-20 shrink-0 items-center justify-center rounded-[22px]">
        <span className="font-display text-4xl text-[#fff3e0]">{initial}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">{platformName}</div>
        <h1 className="font-display mt-1 text-4xl leading-tight sm:text-5xl">{app.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#b9a7b6]">
          {app.bundleId ? (
            <span className="font-mono rounded-full bg-black/25 px-2 py-0.5">{app.bundleId}</span>
          ) : null}
          {app.primaryLocale ? <span>· {app.primaryLocale}</span> : null}
          {app.subtitle ? <span className="italic text-[#d9c9bc]">· {app.subtitle}</span> : null}
        </div>
      </div>
    </div>
  );
}

// ---- ratings ------------------------------------------------------------
function RatingsPanel({ ratings }: { ratings: RatingsSummary | undefined }) {
  if (!ratings) {
    return (
      <Panel title="Ratings">
        <EmptyNote>No ratings yet. They&rsquo;ll appear here once reviewers start arriving.</EmptyNote>
      </Panel>
    );
  }
  const distribution = ratings.distribution;
  const max = distribution ? Math.max(1, ...Object.values(distribution)) : 1;
  return (
    <Panel title="Ratings" note="sampled from newest reviews">
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <div className="font-display text-6xl text-[#fff3e0]">{ratings.average.toFixed(1)}</div>
          <Stars value={ratings.average} />
          <div className="mt-1 text-xs text-[#b9a7b6]">
            {formatNumber(ratings.count)} review{ratings.count === 1 ? "" : "s"}
            {ratings.sampledFromReviews ? " · sampled" : ""}
          </div>
        </div>
        {distribution ? (
          <div className="min-w-[220px] flex-1">
            {(["5", "4", "3", "2", "1"] as const).map((k) => {
              const count = distribution[k];
              const pct = (count / max) * 100;
              return (
                <div key={k} className="mb-1 flex items-center gap-2 text-xs text-[#d9c9bc]">
                  <span className="w-3 font-mono">{k}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, #e7b894, #b489c7)",
                      }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono tabular-nums text-[#b9a7b6]">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---- installs -----------------------------------------------------------
function InstallsPanel({
  installs,
  vendorSet,
}: {
  installs: TimeSeriesStats | undefined;
  vendorSet: boolean;
}) {
  if (!installs) {
    return (
      <Panel title="Installs">
        <EmptyNote>
          {vendorSet
            ? "Vendor # is set but Apple's Sales & Trends API returned no reports for this 30-day window. Reports lag ~24–48h."
            : (
              <>
                Set <code className="font-mono text-[#f3d9bc]">APPSTORE_VENDOR_NUMBER</code> to enable daily download counts from the Sales &amp; Trends API.
              </>
            )}
        </EmptyNote>
      </Panel>
    );
  }
  const avg = installs.total / Math.max(1, installs.points.length);
  return (
    <Panel title="Installs" note="Sales & Trends · daily">
      <div className="font-display mt-2 text-4xl">{formatNumber(installs.total)}</div>
      <div className="mt-1 text-xs text-[#b9a7b6]">
        last {installs.points.length} days · avg {formatNumber(avg)}/day
      </div>
      <div className="mt-5">
        <InstallsChart data={installs} />
      </div>
    </Panel>
  );
}

// ---- financial ----------------------------------------------------------
function FinancePanel({
  finance,
  iap,
  vendorSet,
}: {
  finance?: FinanceSummary;
  iap?: IapSummary;
  vendorSet: boolean;
}) {
  if (!finance && !iap) {
    return (
      <Panel title="Financial">
        <EmptyNote>
          {vendorSet
            ? "Vendor # is set but Apple hasn't returned a Sales & Trends report for this 30-day window yet. Reports lag ~24–48h after the day closes; the Notes box at the bottom shows the exact API response."
            : (
              <>
                No revenue data yet. Set <code className="font-mono text-[#f3d9bc]">APPSTORE_VENDOR_NUMBER</code> in your Vercel env vars and redeploy.
              </>
            )}
        </EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Financial" note="last 30 days">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Developer proceeds" value={formatMoney(finance?.proceeds)} />
        <MetricTile label="Refunds" value={formatMoney(finance?.refunds)} />
        <MetricTile
          label="Paid downloads"
          value={finance?.paidDownloads !== undefined ? formatNumber(finance.paidDownloads) : "—"}
        />
        <MetricTile
          label="Free downloads"
          value={finance?.freeDownloads !== undefined ? formatNumber(finance.freeDownloads) : "—"}
        />
        <MetricTile
          label="App updates"
          value={finance?.updates !== undefined ? formatNumber(finance.updates) : "—"}
        />
        <MetricTile
          label="Redownloads"
          value={finance?.redownloads !== undefined ? formatNumber(finance.redownloads) : "—"}
        />
        <MetricTile
          label="IAP units"
          value={iap?.totalUnits !== undefined ? formatNumber(iap.totalUnits) : "—"}
        />
        <MetricTile label="IAP proceeds" value={formatMoney(iap?.totalProceeds)} />
      </div>
      {finance?.proceedsByCurrency?.length ? (
        <div className="mt-4 text-xs text-[#b9a7b6]">
          <span className="font-medium text-[#d9c9bc]">Storefront currencies: </span>
          {finance.proceedsByCurrency.map((c, i) => (
            <span key={c.currency}>
              {i > 0 ? " · " : ""}
              {formatMoney(c)}
            </span>
          ))}
        </div>
      ) : null}
      {finance?.note ? (
        <div className="mt-2 text-[11px] text-[#8f7d8c]">{finance.note}</div>
      ) : null}
    </Panel>
  );
}

// ---- funnel -------------------------------------------------------------
function FunnelPanel({ funnel }: { funnel: FunnelSummary | undefined }) {
  if (!funnel || (!funnel.impressions && !funnel.productPageViews && !funnel.firstTimeDownloads)) {
    return (
      <Panel title="Funnel · store discovery → page views → first-time downloads">
        <EmptyNote>
          Funnel data is fetched from the App Store Connect Analytics Reports API. The first daily reports arrive ~24h after the ongoing report request is created — reload tomorrow.
        </EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Funnel" note="Analytics Reports · 30 days">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          label="Impressions"
          value={funnel.impressions !== undefined ? formatNumber(funnel.impressions) : "—"}
        />
        <MetricTile
          label="Product page views"
          value={funnel.productPageViews !== undefined ? formatNumber(funnel.productPageViews) : "—"}
        />
        <MetricTile
          label="First-time downloads"
          value={
            funnel.firstTimeDownloads !== undefined ? formatNumber(funnel.firstTimeDownloads) : "—"
          }
        />
        <MetricTile
          label="Conversion rate"
          value={formatPercent(funnel.conversionRate, 2)}
          sub="downloads ÷ impressions"
        />
      </div>
    </Panel>
  );
}

// ---- geography ----------------------------------------------------------
function TerritoriesPanel({ territories }: { territories: TerritoryStat[] | undefined }) {
  if (!territories || !territories.length) {
    return (
      <Panel title="Territories">
        <EmptyNote>No territory breakdown available for this window.</EmptyNote>
      </Panel>
    );
  }
  const top = territories.slice(0, 12);
  const total = top.reduce((s, t) => s + t.units, 0);
  return (
    <Panel title="Territories" note="Sales & Trends · top 12">
      <div className="mt-3">
        {top.map((t) => (
          <ShareBar
            key={t.territory}
            label={`${t.territory}${t.proceeds ? ` · ${formatMoney(t.proceeds)}` : ""}`}
            value={t.units}
            total={total || 1}
          />
        ))}
      </div>
    </Panel>
  );
}

// ---- devices ------------------------------------------------------------
// Sales & Trends' `Device` column is the *acquisition* device — i.e. what
// device the customer was on when they tapped "Get" — not what device the app
// runs on. "Desktop" / "Browser" mean the user came in via apps.apple.com or
// iTunes on Mac/PC; the app still ends up installed on their iPhone/iPad.
// For "what device actually runs the app", see the Active devices panel
// below (sourced from Analytics Reports).
function DevicesPanel({ devices }: { devices: DeviceStat[] | undefined }) {
  if (!devices || !devices.length) {
    return (
      <Panel title="Acquisition device">
        <EmptyNote>Acquisition device breakdown not available for this window.</EmptyNote>
      </Panel>
    );
  }
  const total = devices.reduce((s, d) => s + d.units, 0) || 1;
  return (
    <Panel title="Acquisition device" note="Sales & Trends · where the install was initiated">
      <div className="mt-3">
        {devices.slice(0, 10).map((d) => (
          <ShareBar
            key={d.device}
            label={d.device}
            value={d.units}
            total={total}
            hint={`${formatNumber(d.units)} · ${formatPercent(d.share)}`}
          />
        ))}
      </div>
      <div className="mt-3 text-[11px] leading-relaxed text-[#8f7d8c]">
        Apple reports the device the customer was <em>on when they tapped Get</em>. &ldquo;Desktop&rdquo;
        / &ldquo;Browser&rdquo; means they bought via apps.apple.com or iTunes on a Mac/PC — the
        app still installs on their iPhone/iPad. See <span className="text-[#d9c9bc]">Active devices</span> below
        for what physically runs the app.
      </div>
    </Panel>
  );
}

// ---- sources ------------------------------------------------------------
function SourcesPanel({ sources }: { sources: SourceStat[] | undefined }) {
  if (!sources || !sources.length) {
    return (
      <Panel title="Traffic sources">
        <EmptyNote>
          Source breakdown (search vs browse vs web referrer) comes from the Analytics Reports API.
        </EmptyNote>
      </Panel>
    );
  }
  const total = sources.reduce((s, x) => s + x.units, 0) || 1;
  return (
    <Panel title="Traffic sources" note="Analytics Reports · page views">
      <div className="mt-3">
        {sources.map((s) => (
          <ShareBar
            key={s.source}
            label={s.source}
            value={s.units}
            total={total}
            hint={`${formatNumber(s.units)} · ${formatPercent(s.share)}`}
          />
        ))}
      </div>
    </Panel>
  );
}

// ---- subscriptions ------------------------------------------------------
function SubscriptionsPanel({ subs }: { subs: SubscriptionsSummary | undefined }) {
  if (!subs || !subs.groups.length) {
    return (
      <Panel title="Subscriptions">
        <EmptyNote>
          No subscription reports yet. This panel will populate once Apple processes daily subscription reports.
        </EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Subscriptions" note="Sales & Trends · snapshot + 30d events">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          label="Active subscribers"
          value={subs.totalActive !== undefined ? formatNumber(subs.totalActive) : "—"}
        />
        <MetricTile label="Subscription proceeds" value={formatMoney(subs.totalProceeds)} />
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm text-[#d9c9bc]">
          <thead className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
            <tr>
              <th className="py-2 pr-4">Group</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4">New</th>
              <th className="py-2 pr-4">Renewals</th>
              <th className="py-2 pr-4">Cancels</th>
              <th className="py-2 pr-4">Churn</th>
              <th className="py-2 pr-4">Proceeds</th>
            </tr>
          </thead>
          <tbody>
            {subs.groups.map((g) => (
              <tr key={g.groupName} className="border-t border-white/5">
                <td className="py-2 pr-4">{g.groupName}</td>
                <td className="py-2 pr-4 font-mono">
                  {g.activeSubscribers !== undefined ? formatNumber(g.activeSubscribers) : "—"}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {g.newSubscriptions !== undefined ? formatNumber(g.newSubscriptions) : "—"}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {g.renewals !== undefined ? formatNumber(g.renewals) : "—"}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {g.cancellations !== undefined ? formatNumber(g.cancellations) : "—"}
                </td>
                <td className="py-2 pr-4 font-mono">{formatPercent(g.churnRate)}</td>
                <td className="py-2 pr-4 font-mono">{formatMoney(g.proceeds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---- IAP ----------------------------------------------------------------
function IapPanel({ iap }: { iap: IapSummary | undefined }) {
  if (!iap || !iap.products.length) {
    return (
      <Panel title="In-app purchases">
        <EmptyNote>No IAP activity in the last 30 days.</EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="In-app purchases" note="Sales & Trends · 30 days">
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm text-[#d9c9bc]">
          <thead className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
            <tr>
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Units</th>
              <th className="py-2 pr-4">Proceeds</th>
            </tr>
          </thead>
          <tbody>
            {iap.products.slice(0, 25).map((p) => (
              <tr key={p.sku} className="border-t border-white/5">
                <td className="py-2 pr-4 font-mono">{p.sku}</td>
                <td className="py-2 pr-4">{p.name || "—"}</td>
                <td className="py-2 pr-4 font-mono">{formatNumber(p.units)}</td>
                <td className="py-2 pr-4 font-mono">{formatMoney(p.proceeds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---- search terms -------------------------------------------------------
function SearchTermsPanel({ terms }: { terms: SearchTermStat[] | undefined }) {
  if (!terms || !terms.length) {
    return (
      <Panel title="Search terms">
        <EmptyNote>
          Search term data comes from the Analytics Reports API and can take 24h+ after the request is created.
        </EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Search terms" note="Analytics Reports · top 20">
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm text-[#d9c9bc]">
          <thead className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
            <tr>
              <th className="py-2 pr-4">Term</th>
              <th className="py-2 pr-4">Impressions</th>
              <th className="py-2 pr-4">Page views</th>
              <th className="py-2 pr-4">Downloads</th>
            </tr>
          </thead>
          <tbody>
            {terms.slice(0, 20).map((t) => (
              <tr key={t.term} className="border-t border-white/5">
                <td className="py-2 pr-4">{t.term}</td>
                <td className="py-2 pr-4 font-mono">{formatNumber(t.impressions || 0)}</td>
                <td className="py-2 pr-4 font-mono">{formatNumber(t.pageViews || 0)}</td>
                <td className="py-2 pr-4 font-mono">{formatNumber(t.downloads || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---- active devices -----------------------------------------------------
function ActiveDevicesPanel({ active }: { active: ActiveDevicesSummary | undefined }) {
  if (!active) {
    return (
      <Panel title="Active devices">
        <EmptyNote>Active devices data not yet available.</EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Active devices" note="Analytics Reports · Sessions">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          label="Daily active"
          value={active.daily !== undefined ? formatNumber(active.daily) : "—"}
        />
        <MetricTile
          label="Weekly active"
          value={active.weekly !== undefined ? formatNumber(active.weekly) : "—"}
        />
        <MetricTile
          label="Monthly active"
          value={active.monthly !== undefined ? formatNumber(active.monthly) : "—"}
        />
        <MetricTile
          label="Sessions / device"
          value={
            typeof active.sessionsPerDevice === "number"
              ? active.sessionsPerDevice.toFixed(2)
              : "—"
          }
        />
      </div>
    </Panel>
  );
}

// ---- retention ----------------------------------------------------------
function RetentionPanel({ retention }: { retention: RetentionCohort[] | undefined }) {
  if (!retention || !retention.length) {
    return (
      <Panel title="Retention">
        <EmptyNote>Retention cohorts not available yet.</EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="Retention" note="Analytics Reports · cohort view">
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-sm text-[#d9c9bc]">
          <thead className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
            <tr>
              <th className="py-2 pr-4">Cohort</th>
              <th className="py-2 pr-4">Day 1</th>
              <th className="py-2 pr-4">Day 7</th>
              <th className="py-2 pr-4">Day 28</th>
            </tr>
          </thead>
          <tbody>
            {retention.slice(-10).map((c) => (
              <tr key={c.cohortDate} className="border-t border-white/5">
                <td className="py-2 pr-4 font-mono">{c.cohortDate}</td>
                <td className="py-2 pr-4 font-mono">{formatPercent(c.day1)}</td>
                <td className="py-2 pr-4 font-mono">{formatPercent(c.day7)}</td>
                <td className="py-2 pr-4 font-mono">{formatPercent(c.day28)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---- app versions -------------------------------------------------------
function AppVersionsPanel({ versions }: { versions: AppVersionStat[] | undefined }) {
  if (!versions || !versions.length) {
    return (
      <Panel title="App versions">
        <EmptyNote>Version adoption data not yet available.</EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="App versions" note="Analytics Reports · active device share">
      <div className="mt-3">
        {versions.slice(0, 12).map((v) => (
          <ShareBar
            key={v.version}
            label={v.version}
            value={v.adoption || 0}
            total={1}
            hint={formatPercent(v.adoption)}
          />
        ))}
      </div>
    </Panel>
  );
}

// ---- TestFlight ---------------------------------------------------------
function TestFlightPanel({ tf }: { tf: TestFlightSummary | undefined }) {
  if (!tf) {
    return (
      <Panel title="TestFlight">
        <EmptyNote>No TestFlight builds or testers visible to this API key.</EmptyNote>
      </Panel>
    );
  }
  return (
    <Panel title="TestFlight" note="recent builds + tester counts">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricTile
          label="Internal testers"
          value={tf.internalTesters !== undefined ? formatNumber(tf.internalTesters) : "—"}
        />
        <MetricTile
          label="External testers"
          value={tf.externalTesters !== undefined ? formatNumber(tf.externalTesters) : "—"}
        />
        <MetricTile label="Builds shown" value={formatNumber(tf.builds.length)} />
      </div>
      {tf.builds.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm text-[#d9c9bc]">
            <thead className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
              <tr>
                <th className="py-2 pr-4">Version</th>
                <th className="py-2 pr-4">Build</th>
                <th className="py-2 pr-4">Uploaded</th>
                <th className="py-2 pr-4">State</th>
              </tr>
            </thead>
            <tbody>
              {tf.builds.slice(0, 15).map((b) => (
                <tr key={`${b.version}-${b.buildNumber}`} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-mono">{b.version}</td>
                  <td className="py-2 pr-4 font-mono">{b.buildNumber}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {b.uploadedDate ? formatBerlinDateTime(b.uploadedDate) : "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {b.expired ? "expired" : b.processingState || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

// ---- performance --------------------------------------------------------
function PerformancePanel({
  metrics,
  crashes,
}: {
  metrics: PerformanceMetric[] | undefined;
  crashes: AppSnapshot["crashes"];
}) {
  if ((!metrics || !metrics.length) && !crashes) {
    return (
      <Panel title="Performance">
        <EmptyNote>
          Apple only publishes perf &amp; power metrics once the app has enough active devices. Check back after more installs.
        </EmptyNote>
      </Panel>
    );
  }
  const headline: PerformanceMetric[] = (metrics || []).slice(0, 8);
  return (
    <Panel title="Performance" note="iPhone · all devices">
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {headline.map((m) => (
          <MetricTile
            key={m.identifier}
            label={m.displayName}
            value={
              typeof m.value === "number"
                ? formatNumber(m.value)
                : m.value?.toString() || "—"
            }
            sub={m.unit}
          />
        ))}
      </div>
      {crashes ? (
        <div className="mt-5 rounded-2xl border border-white/5 bg-black/15 p-4 text-xs text-[#d9c9bc]">
          <div className="font-medium text-[#f3e7d7]">Crash &amp; hang signal</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {typeof crashes.crashCount === "number" ? (
              <span>Crashes: {formatNumber(crashes.crashCount)}</span>
            ) : null}
            {typeof crashes.hangRate === "number" ? (
              <span>Hang rate: {crashes.hangRate.toFixed(2)}</span>
            ) : null}
            {typeof crashes.crashFreeUsers === "number" ? (
              <span>Crash-free users: {(crashes.crashFreeUsers * 100).toFixed(1)}%</span>
            ) : null}
          </div>
          {crashes.note ? <div className="mt-2 text-[#8f7d8c]">{crashes.note}</div> : null}
        </div>
      ) : null}
    </Panel>
  );
}

// ---- reviews ------------------------------------------------------------
function ReviewsPanel({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) {
    return (
      <Panel title="Reviews">
        <EmptyNote>No reviews yet.</EmptyNote>
      </Panel>
    );
  }
  return (
    <div className="card-glass rounded-3xl p-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Reviews</div>
          <h2 className="font-display mt-2 text-3xl">Latest voices</h2>
        </div>
        <span className="text-xs text-[#b9a7b6]">{reviews.length} shown · newest first</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {reviews.map((r) => (
          <article
            key={r.id}
            className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-black/15 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Stars value={r.rating} size="sm" />
              <span className="font-mono text-[10px] text-[#8f7d8c]">
                {formatReviewDate(r.createdAt)}
              </span>
            </div>
            {r.title ? (
              <h3 className="font-display text-lg leading-tight text-[#f3e7d7]">{r.title}</h3>
            ) : null}
            <p className="text-sm leading-relaxed text-[#d9c9bc]">{r.body}</p>
            <div className="mt-auto flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-[#8f7d8c]">
              <span>{r.author || "Anonymous"}</span>
              {r.territory ? <span>· {r.territory}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ---- setup state --------------------------------------------------------
function IosSetup() {
  return (
    <>
      <h1 className="font-display mt-3 text-4xl">Connect App Store Connect</h1>
      <p className="mt-4 text-[#d9c9bc]">
        This page reads iOS analytics directly from the App Store Connect API. Add these env
        vars to <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[#f3d9bc]">.env.local</code>
        (locally) and your Vercel project settings (for production), then reload.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-[#d9c9bc]">
        <li>
          <span className="font-mono text-[#f3d9bc]">APPSTORE_KEY_ID</span> — the Key ID shown in Users &amp; Access → Keys.
        </li>
        <li>
          <span className="font-mono text-[#f3d9bc]">APPSTORE_ISSUER_ID</span> — the Issuer ID at the top of the same page.
        </li>
        <li>
          <span className="font-mono text-[#f3d9bc]">APPSTORE_PRIVATE_KEY</span> — the full contents of the <span className="font-mono">.p8</span> file (or base64-encoded).
        </li>
        <li>
          <span className="font-mono text-[#f3d9bc]">APPSTORE_APP_ID</span> <span className="text-[#8f7d8c]">(optional)</span> — the numeric Apple ID for a specific app. If not set, the first app returned by the API is used.
        </li>
        <li>
          <span className="font-mono text-[#f3d9bc]">APPSTORE_VENDOR_NUMBER</span> <span className="text-[#8f7d8c]">(optional)</span> — enables Sales &amp; Trends data: installs, proceeds, refunds, territories, device split, IAP, subscriptions.
        </li>
      </ul>
    </>
  );
}

function AndroidSetup({
  diagnostics,
}: {
  // When env vars are partially set or the JSON fails to parse we render a
  // banner above the steps so the user doesn't have to guess what's missing.
  diagnostics: ReturnType<typeof inspectGooglePlayConfig>;
}) {
  const showBanner =
    diagnostics.present.length > 0 ||
    diagnostics.missing.length > 0 ||
    !!diagnostics.parseError;
  return (
    <>
      <h1 className="font-display mt-3 text-4xl">Connect Google Play Console</h1>
      <p className="mt-4 text-[#d9c9bc]">
        This page reads Android analytics from the Play Developer API and Play Reporting API.
        You&rsquo;ll need a Google Cloud service account with access granted in the Play Console.
      </p>
      {showBanner ? (
        <div
          className={[
            "mt-6 rounded-2xl border p-4 text-sm",
            diagnostics.parseError || diagnostics.missing.length
              ? "border-[#e88a8a]/40 bg-[#e88a8a]/10 text-[#ffd7d7]"
              : "border-[#9cd49c]/30 bg-[#9cd49c]/10 text-[#dff5df]",
          ].join(" ")}
        >
          <div className="font-semibold">Configuration check</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {diagnostics.present.map((v) => (
              <li key={v}>
                Found <span className="font-mono text-[#f3d9bc]">{v}</span>.
              </li>
            ))}
            {diagnostics.missing.map((v) => (
              <li key={v}>
                Missing <span className="font-mono text-[#f3d9bc]">{v}</span> — add it to{" "}
                <span className="font-mono">.env.local</span> (and Vercel env vars for production)
                and restart <span className="font-mono">next dev</span>.
              </li>
            ))}
            {diagnostics.parseError ? (
              <li>
                Couldn&rsquo;t parse the credentials: {diagnostics.parseError}
              </li>
            ) : null}
            {diagnostics.present.length > 0 && diagnostics.missing.length === 0 && !diagnostics.parseError ? (
              <li>
                Credentials look valid. If this page is still showing, hard-reload the browser
                tab — the dev server may need a moment.
              </li>
            ) : null}
          </ul>
          {diagnostics.present.length === 0 ? (
            <p className="mt-3 text-[#ffd7d7]/80">
              No Google Play env vars detected at all. If you just added them to{" "}
              <span className="font-mono">.env.local</span>, restart{" "}
              <span className="font-mono">npm run dev</span> — Next only reads env files at
              boot. On Vercel, set them in <em>Project Settings → Environment Variables</em> for
              the right environment scope and trigger a redeploy.
            </p>
          ) : null}
        </div>
      ) : null}
      <ol className="mt-6 space-y-3 text-sm text-[#d9c9bc] list-decimal list-outside pl-5 marker:text-[#e7b894]">
        <li>
          In <span className="italic">Google Cloud Console</span> → IAM &amp; Admin → Service accounts, create a new service account.
          Open its <span className="italic">Keys</span> tab and Add Key → JSON. A file like
          <span className="font-mono"> catharsis-play-xxxxxxx.json</span> downloads.
        </li>
        <li>
          In <span className="italic">Google Cloud Console</span> → APIs &amp; Services → Library, enable both
          <span className="font-mono text-[#f3d9bc]"> Google Play Android Developer API</span> and
          <span className="font-mono text-[#f3d9bc]"> Google Play Developer Reporting API</span>.
        </li>
        <li>
          In <span className="italic">Google Play Console</span> → Users and permissions → Invite new user,
          paste the service account&rsquo;s <span className="font-mono">client_email</span> (ends in
          <span className="font-mono"> .gserviceaccount.com</span>) and grant it <span className="italic">app
          access</span> to your app. Needed permissions: <span className="italic">View app information</span>,
          <span className="italic"> View financial data</span>, <span className="italic">Reply to reviews</span>.
        </li>
        <li>
          Set these env vars:
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              <span className="font-mono text-[#f3d9bc]">GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64</span> — output of
              <span className="font-mono"> base64 -i catharsis-play-xxxxxxx.json</span>. Safer than the raw JSON variant because newline escaping is a nightmare.
            </li>
            <li>
              <span className="font-mono text-[#f3d9bc]">GOOGLEPLAY_PACKAGE_NAME</span> — e.g.
              <span className="font-mono"> com.catharsis.cards</span>.
            </li>
          </ul>
        </li>
        <li>
          Redeploy (or <span className="font-mono">next dev</span>) and switch the platform toggle to <em>Google Play</em>.
          Reviews + app vitals should appear immediately; install counts, revenue and traffic sources need the Play Console
          Statistics CSV export which isn&rsquo;t wired in yet.
        </li>
      </ol>
    </>
  );
}

function SetupState({ platform }: { platform: Platform }) {
  // Only compute the Android diagnostic when we're showing the Android setup
  // — for iOS this would be wasted work and the iOS setup doesn't render it.
  const diagnostics = platform === "android" ? inspectGooglePlayConfig() : undefined;
  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="card-glass rounded-[2rem] p-10">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">
              Mobile analytics
            </div>
            <PlatformToggle
              active={platform}
              iosConfigured={!!getProvider("ios")?.isConfigured()}
              androidConfigured={!!getProvider("android")?.isConfigured()}
            />
          </div>
          {platform === "ios" ? <IosSetup /> : <AndroidSetup diagnostics={diagnostics!} />}
          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full bg-[#f3e7d7] px-5 py-3 text-sm font-medium text-[#2a1220] transition hover:bg-[#fff3e0]"
            >
              ← Back to social analytics
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---- page ---------------------------------------------------------------
export default async function AppAnalyticsPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise. We destructure after awaiting so the
  // platform toggle (/app?platform=android) can deep-link into either view.
  searchParams: Promise<{ platform?: string }>;
}) {
  const { platform: platformParam } = await searchParams;
  const platform: Platform = platformParam === "android" ? "android" : "ios";

  const iosConfigured = !!getProvider("ios")?.isConfigured();
  const androidConfigured = !!getProvider("android")?.isConfigured();

  const provider = getProvider(platform);
  if (!provider || !provider.isConfigured()) {
    return <SetupState platform={platform} />;
  }

  let snapshot: AppSnapshot | null = null;
  let error: string | null = null;

  try {
    const apps = await provider.listApps();
    // Each provider has a different "preferred app" env var. For iOS it's the
    // numeric Apple ID; for Android it's the package name (which also happens
    // to be the app's id in our Google Play integration).
    const preferredId =
      platform === "ios"
        ? process.env.APPSTORE_APP_ID
        : process.env.GOOGLEPLAY_PACKAGE_NAME;
    const chosen = apps.find((a) => a.id === preferredId) || apps[0];
    if (!chosen) {
      error =
        platform === "ios"
          ? "The API key is valid but no apps are visible to it. In App Store Connect, give this key access to at least one app."
          : "The service account is valid but no apps are visible to it. In Google Play Console, invite its client_email and grant app access.";
    } else {
      snapshot = await provider.fetchSnapshot(chosen.id);
    }
  } catch (err) {
    error =
      err instanceof Error
        ? err.message
        : platform === "ios"
          ? "Unknown error contacting App Store Connect"
          : "Unknown error contacting Google Play Console";
  }

  const nowTz = berlinTzLabel(new Date());
  // Sales & Trends vendor number only gates iOS revenue/install panels.
  // Google Play has no equivalent gate — those panels degrade via warnings in
  // the snapshot instead.
  const vendorSet = platform === "ios" ? !!process.env.APPSTORE_VENDOR_NUMBER : true;

  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10">
        {snapshot ? (
          <header className="card-glass rounded-[2rem] p-8 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <AppHeader app={snapshot.app} platformName={provider.displayName} />
              <PlatformToggle
                active={platform}
                iosConfigured={iosConfigured}
                androidConfigured={androidConfigured}
              />
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <MetricTile
                label="Average rating"
                value={snapshot.ratings ? snapshot.ratings.average.toFixed(2) : "—"}
                sub={
                  snapshot.ratings
                    ? `${formatNumber(snapshot.ratings.count)} reviews sampled`
                    : "no reviews yet"
                }
              />
              <MetricTile
                label="Installs (30d)"
                value={snapshot.installs ? formatNumber(snapshot.installs.total) : "—"}
                sub={
                  snapshot.installs
                    ? "Sales & Trends"
                    : vendorSet
                    ? "no reports yet"
                    : "vendor # not set"
                }
              />
              <MetricTile
                label="Proceeds (30d)"
                value={formatMoney(snapshot.finance?.proceeds)}
                sub={
                  snapshot.finance?.proceeds
                    ? "developer proceeds"
                    : vendorSet
                    ? "no reports yet"
                    : "vendor # not set"
                }
              />
              <MetricTile
                label="Active subscribers"
                value={
                  snapshot.subscriptions?.totalActive !== undefined
                    ? formatNumber(snapshot.subscriptions.totalActive)
                    : "—"
                }
                sub={
                  snapshot.subscriptions?.totalProceeds
                    ? `proceeds ${formatMoney(snapshot.subscriptions.totalProceeds)}`
                    : "no subscription data"
                }
              />
            </div>
          </header>
        ) : null}

        {error ? (
          <section className="rounded-2xl border border-[#e88a8a]/30 bg-[#e88a8a]/10 p-5 text-sm text-[#ffd7d7]">
            <div className="font-semibold">Could not load App Store Connect data</div>
            <div className="mt-1 whitespace-pre-wrap text-[#ffd7d7]/80">{error}</div>
          </section>
        ) : null}

        {snapshot ? (
          <>
            <DashboardTabs
              overview={
                <>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Ratings & installs" note="newest first" />
                    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
                      <RatingsPanel ratings={snapshot.ratings} />
                      <InstallsPanel installs={snapshot.installs} vendorSet={vendorSet} />
                    </div>
                    <ReviewsPanel reviews={snapshot.reviews} />
                  </section>
                </>
              }
              revenue={
                <>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Financial" note="Sales & Trends · 30 days" />
                    <FinancePanel
                      finance={snapshot.finance}
                      iap={snapshot.iap}
                      vendorSet={vendorSet}
                    />
                    <IapPanel iap={snapshot.iap} />
                  </section>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Subscriptions" note="Sales & Trends" />
                    <SubscriptionsPanel subs={snapshot.subscriptions} />
                  </section>
                </>
              }
              acquisition={
                <>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Funnel" note="Analytics Reports API" />
                    <FunnelPanel funnel={snapshot.funnel} />
                    <SourcesPanel sources={snapshot.sources} />
                  </section>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Search" />
                    <SearchTermsPanel terms={snapshot.searchTerms} />
                  </section>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Geography & device" />
                    <div className="grid gap-5 lg:grid-cols-2">
                      <TerritoriesPanel territories={snapshot.territories} />
                      <DevicesPanel devices={snapshot.devices} />
                    </div>
                  </section>
                </>
              }
              engagement={
                <>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Active users" note="Analytics Reports" />
                    <ActiveDevicesPanel active={snapshot.activeDevices} />
                    <RetentionPanel retention={snapshot.retention} />
                  </section>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="App versions" />
                    <AppVersionsPanel versions={snapshot.appVersions} />
                  </section>
                </>
              }
              quality={
                <>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="Performance & stability" />
                    <PerformancePanel
                      metrics={snapshot.performance}
                      crashes={snapshot.crashes}
                    />
                  </section>
                  <section className="flex flex-col gap-5">
                    <SectionHeader title="TestFlight" />
                    <TestFlightPanel tf={snapshot.testflight} />
                  </section>
                </>
              }
            />

            {snapshot.warnings.length ? (
              <section className="rounded-2xl border border-[#e7b894]/20 bg-[#e7b894]/5 p-5 text-sm text-[#f3d9bc]">
                <div className="font-semibold">Notes</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[#f3d9bc]/85">
                  {snapshot.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <footer className="pb-4 text-center text-[11px] uppercase tracking-[0.28em] text-[#8f7d8c]">
              Catharsis · app analytics · generated {formatBerlinDateTime(snapshot.generatedAt)} · times in {nowTz}
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
