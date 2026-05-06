import Link from "next/link";
import {
  fetchWebSnapshot,
  inspectWebConfig,
  isWebConfigured,
  type WebDailyPoint,
  type WebDeviceStat,
  type WebGeoStat,
  type WebKeyEventStat,
  type WebKpis,
  type WebSnapshot,
  type WebTopPage,
  type WebTrafficSource,
} from "@/lib/analytics/web";
import { parsePeriod, periodLabel, type Period } from "@/lib/period";
import PeriodToggle from "../_components/period-toggle";
import { berlinTzLabel, formatBerlinDateTime } from "@/lib/tz";

// /web is dynamic — every visit hits GA4 fresh. The shared loading.tsx now
// covers the perceived-latency problem; if we eventually want true caching
// we'll move to unstable_cache + a manual refresh button.
export const dynamic = "force-dynamic";

// ---- formatting helpers -------------------------------------------------
function formatNumber(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-GB").format(Math.round(v));
}

function formatPercent(v: number | undefined, digits = 1): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function deltaPct(now: number | undefined, prior: number | undefined): number | undefined {
  if (now === undefined || prior === undefined || prior === 0) return undefined;
  return (now - prior) / prior;
}

function DeltaBadge({ value }: { value: number | undefined }) {
  if (value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const color = up ? "text-[#a8d99a]" : "text-[#e88a8a]";
  const arrow = up ? "↑" : "↓";
  return (
    <span className={`font-mono text-[11px] tabular-nums ${color}`}>
      {arrow} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

// ---- shared visual primitives ------------------------------------------
function MetricTile({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="break-words font-display text-3xl text-[#f3e7d7]">{value}</div>
        <DeltaBadge value={delta} />
      </div>
      {sub ? <div className="mt-1 text-xs text-[#8f7d8c]">{sub}</div> : null}
    </div>
  );
}

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-white/5 pb-2">
      <h2 className="font-display text-2xl text-[#f3e7d7]">{title}</h2>
      {note ? (
        <span className="text-[10px] uppercase tracking-[0.2em] text-[#8f7d8c]">{note}</span>
      ) : null}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 text-sm text-[#b9a7b6]">{children}</div>;
}

function Panel({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="card-glass min-w-0 overflow-hidden rounded-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">{title}</div>
        {note ? <span className="text-[10px] text-[#8f7d8c]">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

// ---- daily traffic chart -----------------------------------------------
function TrafficChart({ data, periodNote }: { data: WebDailyPoint[]; periodNote: string }) {
  if (!data.length) return <EmptyNote>No daily traffic in {periodNote}.</EmptyNote>;
  const max = Math.max(1, ...data.map((p) => p.sessions));
  const n = data.length;

  // Bars stay narrow so the chart fits without horizontal scrolling for the
  // common 7d / 30d windows; for 90d and 365d we let it scroll because the
  // alternative (sub-pixel bars) looks like noise.
  const BAR_W = n <= 7 ? 36 : n <= 30 ? 18 : n <= 90 ? 10 : 6;
  const BAR_GAP = n <= 7 ? 14 : n <= 30 ? 10 : n <= 90 ? 6 : 3;
  const CHART_H = 140;
  const LABEL_Y = CHART_H + 22;
  const width = n * (BAR_W + BAR_GAP);

  // Date labels at ~50–60px font cadence look right at 9px monospace
  // (~5px per char, "MM-DD" = 5 chars ≈ 25px wide). We pick a step that
  // keeps two adjacent labels at least ~50px apart.
  const MIN_LABEL_PX = 56;
  const labelStep = Math.max(1, Math.ceil(MIN_LABEL_PX / (BAR_W + BAR_GAP)));

  // Format depends on the window: short windows show day-month; longer
  // windows show month-day with the year compressed away. Always anchor
  // the *last* day so the most recent date sits flush right.
  const formatLabel = (iso: string): string => {
    // GA4 hands us YYYY-MM-DD; show MM-DD for everything 30d and under,
    // and for longer windows show the day-of-month for the cadence we
    // pick so the line stays scannable.
    return iso.slice(5);
  };

  return (
    <div className="overflow-x-auto cathars-scroll mt-5">
      <svg width={width} height={CHART_H + 36} role="img" aria-label="Daily sessions">
        {data.map((p, i) => {
          const h = (p.sessions / max) * CHART_H;
          const x = i * (BAR_W + BAR_GAP);
          const y = CHART_H - h;
          // Show the date label every `labelStep` bars, anchored to the
          // *last* bar so today's date is always visible. Reverse-mod
          // counting: i counts back from n-1, so (n-1-i) % step === 0.
          const showLabel = (n - 1 - i) % labelStep === 0;
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={BAR_W}
                height={h}
                rx={3}
                fill="url(#webGrad)"
                opacity={p.sessions === 0 ? 0.35 : 1}
              />
              {showLabel ? (
                <text
                  x={x + BAR_W / 2}
                  y={LABEL_Y}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#8f7d8c"
                  fontFamily="monospace"
                >
                  {formatLabel(p.date)}
                </text>
              ) : null}
            </g>
          );
        })}
        <defs>
          <linearGradient id="webGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#e7b894" />
            <stop offset="100%" stopColor="#b489c7" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// ---- panels ------------------------------------------------------------
function TopPagesPanel({
  pages,
  periodNote,
}: {
  pages: WebTopPage[] | undefined;
  periodNote: string;
}) {
  return (
    <Panel title="Top pages" note={`${periodNote} · GA4`}>
      {!pages || !pages.length ? (
        <EmptyNote>No page-view data in {periodNote}.</EmptyNote>
      ) : (
        <div className="mt-4 overflow-x-auto cathars-scroll">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
                <th className="px-3 py-2 text-left font-medium">Path</th>
                <th className="px-3 py-2 text-right font-medium">Views</th>
                <th className="px-3 py-2 text-right font-medium">Users</th>
                <th className="px-3 py-2 text-right font-medium">Avg eng. time</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={`${p.path}-${p.title || ""}`} className="border-t border-white/5 align-top">
                  <td className="px-3 py-2 text-[#f3e7d7]">
                    <div className="font-mono text-xs text-[#d9c9bc]">{p.path}</div>
                    {p.title ? (
                      <div className="mt-0.5 text-[11px] text-[#8f7d8c]">{p.title}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#f3e7d7]">
                    {formatNumber(p.views)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#d9c9bc]">
                    {formatNumber(p.users)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#d9c9bc]">
                    {formatDuration(p.avgEngagementTimeSec)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SourcesPanel({ sources }: { sources: WebTrafficSource[] | undefined }) {
  return (
    <Panel title="Traffic sources" note="session source / medium">
      {!sources || !sources.length ? (
        <EmptyNote>No source data attributed yet.</EmptyNote>
      ) : (
        <div className="mt-4 overflow-x-auto cathars-scroll">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Medium</th>
                <th className="px-3 py-2 text-right font-medium">Sessions</th>
                <th className="px-3 py-2 text-right font-medium">Users</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={`${s.source}-${s.medium}-${i}`} className="border-t border-white/5">
                  <td className="px-3 py-2 text-[#f3e7d7]">{s.source}</td>
                  <td className="px-3 py-2 text-[#d9c9bc]">{s.medium}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#f3e7d7]">
                    {formatNumber(s.sessions)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#d9c9bc]">
                    {formatNumber(s.users)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function GeographyPanel({ geo }: { geo: WebGeoStat[] | undefined }) {
  return (
    <Panel title="Geography" note="sessions by country">
      {!geo || !geo.length ? (
        <EmptyNote>No country data yet.</EmptyNote>
      ) : (
        <ul className="mt-4 space-y-1.5 text-sm">
          {geo.slice(0, 12).map((g) => (
            <li
              key={g.country}
              className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0"
            >
              <span className="text-[#f3e7d7]">{g.country}</span>
              <span className="font-mono tabular-nums text-[#d9c9bc]">
                {formatNumber(g.sessions)}{" "}
                <span className="text-[#8f7d8c]">· {formatNumber(g.users)} users</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DevicesPanel({ devices }: { devices: WebDeviceStat[] | undefined }) {
  return (
    <Panel title="Devices" note="device category">
      {!devices || !devices.length ? (
        <EmptyNote>No device data yet.</EmptyNote>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {devices.map((d) => (
            <li key={d.category}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[#f3e7d7] capitalize">{d.category}</span>
                <span className="font-mono text-xs tabular-nums text-[#d9c9bc]">
                  {formatNumber(d.sessions)}
                  {d.share !== undefined ? (
                    <span className="text-[#8f7d8c]"> · {formatPercent(d.share, 0)}</span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#e7b894] to-[#b489c7]"
                  style={{ width: `${Math.min(100, (d.share || 0) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function KeyEventsPanel({ events }: { events: WebKeyEventStat[] | undefined }) {
  return (
    <Panel title="Key events" note="conversions">
      {!events || !events.length ? (
        <EmptyNote>
          No key events recorded. In GA4 → Admin → Events, mark which events count as key
          events (conversions) and they&apos;ll show up here.
        </EmptyNote>
      ) : (
        <div className="mt-4 overflow-x-auto cathars-scroll">
          <table className="w-full min-w-[360px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
                <th className="px-3 py-2 text-left font-medium">Event</th>
                <th className="px-3 py-2 text-right font-medium">Count</th>
                <th className="px-3 py-2 text-right font-medium">Per session</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.name} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-[#f3e7d7]">{e.name}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#f3e7d7]">
                    {formatNumber(e.count)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#d9c9bc]">
                    {formatPercent(e.conversionRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---- header ------------------------------------------------------------
function WebHeader({ snapshot }: { snapshot: WebSnapshot }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#e7b894]/15 ring-1 ring-[#e7b894]/40">
        <svg
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinejoin="miter"
          strokeLinecap="square"
          className="h-9 w-9 text-[#e7b894]"
          aria-hidden
        >
          <path d="M 18 22 H 70 V 34 H 60 V 44 H 70 V 70 H 18 Z" />
          <path d="M 30 30 H 82 V 56 H 72 V 66 H 82 V 78 H 30 Z" />
          <path
            d="M 50 38 L 53 50 L 65 53 L 53 56 L 50 68 L 47 56 L 35 53 L 47 50 Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <div className="font-display text-3xl text-[#f3e7d7]">{snapshot.hostname}</div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#b9a7b6]">
          GA4 property {snapshot.propertyId} · {periodLabel(snapshot.period)}
        </div>
      </div>
    </div>
  );
}

// ---- setup state -------------------------------------------------------
function WebSetup() {
  const diag = inspectWebConfig();
  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
        <div className="card-glass rounded-[2rem] p-8 sm:p-10">
          <div className="text-[10px] uppercase tracking-[0.28em] text-[#8f7d8c]">Setup required</div>
          <h1 className="mt-3 font-display text-3xl text-[#f3e7d7]">Connect Google Analytics 4</h1>
          <p className="mt-3 text-sm text-[#d9c9bc]">
            The Web tab pulls daily metrics from GA4 (catharsis.cards) using the Data API.
            By default it reuses the same Google Cloud service account configured for the
            App tab — you just need to grant that service-account email Viewer access on
            the GA4 property.
          </p>

          <div className="mt-6 grid gap-2 text-xs text-[#b9a7b6]">
            <div>
              <span className="text-[#8f7d8c]">We see:</span>{" "}
              {diag.present.length ? diag.present.join(", ") : "nothing yet"}
            </div>
            <div>
              <span className="text-[#8f7d8c]">Missing:</span>{" "}
              {diag.missing.length ? diag.missing.join(", ") : "—"}
            </div>
            {diag.parseError ? (
              <div className="text-[#e88a8a]">{diag.parseError}</div>
            ) : null}
          </div>

          <ol className="mt-8 space-y-6 text-sm text-[#d9c9bc]">
            <li>
              <div className="font-display text-lg text-[#f3e7d7]">
                1 · Find your GA4 property ID
              </div>
              <p className="mt-1.5">
                In Google Analytics → Admin → Property settings, copy the{" "}
                <span className="font-mono text-[#f3d9bc]">Property ID</span> — the 9-digit
                number under the property name. It is{" "}
                <span className="italic">not</span> the measurement ID
                (<span className="font-mono text-[#f3d9bc]">G-XXXXXX</span>) shown on the
                data-stream page.
              </p>
              <p className="mt-1.5">
                Add it to your env as{" "}
                <span className="font-mono text-[#f3d9bc]">GA4_PROPERTY_ID</span>. On Vercel
                it goes in Project → Settings → Environment Variables.
              </p>
            </li>

            <li>
              <div className="font-display text-lg text-[#f3e7d7]">
                2 · Grant the Play service account Viewer access on the property
              </div>
              <p className="mt-1.5">
                In GA4 → Admin → Property access management → <span className="font-mono text-[#f3d9bc]">+</span> →
                Add users, paste the <span className="font-mono text-[#f3d9bc]">client_email</span> from your
                Play service-account JSON (looks like{" "}
                <span className="font-mono text-[#f3d9bc]">name@project.iam.gserviceaccount.com</span>),
                pick the <span className="font-mono text-[#f3d9bc]">Viewer</span> role,
                untick &ldquo;Notify new users by email&rdquo; (service accounts have no inbox), and save.
              </p>
              <p className="mt-1.5 text-[11px] text-[#8f7d8c]">
                We use the service account because Google&apos;s risk-based auth blocks the
                gcloud user-OAuth client when it asks for the analytics scope.
                Service-account JWT auth bypasses the consent screen entirely.
              </p>
            </li>

            <li>
              <div className="font-display text-lg text-[#f3e7d7]">
                3 · Enable the Analytics Data API in your GCP project
              </div>
              <p className="mt-1.5">
                Open{" "}
                <span className="font-mono text-[#f3d9bc]">
                  console.cloud.google.com/apis/library/analyticsdata.googleapis.com
                </span>{" "}
                in the same project that owns your service account, click{" "}
                <span className="font-mono text-[#f3d9bc]">Enable</span>. Or via gcloud:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-4 text-[11px] text-[#f3d9bc]">
{`gcloud services enable analyticsdata.googleapis.com`}
              </pre>
            </li>

            <li>
              <div className="font-display text-lg text-[#f3e7d7]">4 · Redeploy</div>
              <p className="mt-1.5">
                Push or redeploy on Vercel and refresh this page. New properties take
                ~24 hours to start serving non-empty reports — if you just installed the
                tag, give it a day.
              </p>
            </li>

            <li>
              <div className="font-display text-lg text-[#f3e7d7]">
                Optional · Use a separate service account for GA4
              </div>
              <p className="mt-1.5">
                If you&apos;d rather isolate GA4 auth from Play, create a fresh service
                account in Google Cloud and set its JSON as{" "}
                <span className="font-mono text-[#f3d9bc]">GA4_SERVICE_ACCOUNT_JSON_BASE64</span>.
                Same Viewer-grant + API-enable steps apply to that account&apos;s email.
              </p>
            </li>
          </ol>

          <div className="mt-10">
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

// ---- page --------------------------------------------------------------
export default async function WebAnalyticsPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise. We resolve it before reading so the
  // ?period=7d|30d|90d|365d query string drives the snapshot window.
  searchParams: Promise<{ period?: string }>;
}) {
  if (!isWebConfigured()) {
    return <WebSetup />;
  }

  const { period: periodParam } = await searchParams;
  const period: Period = parsePeriod(periodParam);

  let snapshot: WebSnapshot | null = null;
  let priorKpis: WebKpis | undefined;
  let error: string | null = null;

  try {
    const result = await fetchWebSnapshot(period);
    snapshot = result.snapshot;
    priorKpis = result.priorKpis;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error contacting GA4";
  }

  const nowTz = berlinTzLabel(new Date());
  // Short label used inside KPI tile labels: "Active users (7d)".
  const shortP = period.toUpperCase();

  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10">
        {snapshot ? (
          <header className="card-glass rounded-[2rem] p-8 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <WebHeader snapshot={snapshot} />
              <PeriodToggle active={period} basePath="/web" />
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <MetricTile
                label={`Active users (${shortP})`}
                value={formatNumber(snapshot.kpis.activeUsers)}
                sub={
                  snapshot.kpis.sessions !== undefined
                    ? `${formatNumber(snapshot.kpis.sessions)} sessions`
                    : "no sessions yet"
                }
                delta={deltaPct(snapshot.kpis.activeUsers, priorKpis?.activeUsers)}
              />
              <MetricTile
                label={`Page views (${shortP})`}
                value={formatNumber(snapshot.kpis.pageViews)}
                sub="screen_view + page_view"
                delta={deltaPct(snapshot.kpis.pageViews, priorKpis?.pageViews)}
              />
              <MetricTile
                label="Avg engagement time"
                value={formatDuration(snapshot.kpis.avgEngagementTimeSec)}
                sub="per session"
                delta={deltaPct(
                  snapshot.kpis.avgEngagementTimeSec,
                  priorKpis?.avgEngagementTimeSec,
                )}
              />
              <MetricTile
                label={`Key events (${shortP})`}
                value={formatNumber(snapshot.kpis.keyEvents)}
                sub={
                  snapshot.kpis.keyEvents
                    ? "GA4 conversions"
                    : "none flagged in GA4"
                }
                delta={deltaPct(snapshot.kpis.keyEvents, priorKpis?.keyEvents)}
              />
            </div>
          </header>
        ) : null}

        {error ? (
          <section className="rounded-2xl border border-[#e88a8a]/30 bg-[#e88a8a]/10 p-5 text-sm text-[#ffd7d7]">
            <div className="font-semibold">Could not load Google Analytics data</div>
            <div className="mt-1 whitespace-pre-wrap text-[#ffd7d7]/80">{error}</div>
          </section>
        ) : null}

        {snapshot ? (
          <>
            <section className="flex flex-col gap-5">
              <SectionHeader title="Traffic" note={periodLabel(period)} />
              <Panel title="Daily sessions" note="GA4 · property TZ">
                <TrafficChart data={snapshot.daily || []} periodNote={periodLabel(period)} />
              </Panel>
              <TopPagesPanel pages={snapshot.topPages} periodNote={periodLabel(period)} />
            </section>

            <section className="flex flex-col gap-5">
              <SectionHeader title="Acquisition" />
              <SourcesPanel sources={snapshot.sources} />
            </section>

            <section className="flex flex-col gap-5">
              <SectionHeader title="Audience" />
              <div className="grid gap-5 lg:grid-cols-2">
                <GeographyPanel geo={snapshot.geography} />
                <DevicesPanel devices={snapshot.devices} />
              </div>
            </section>

            <section className="flex flex-col gap-5">
              <SectionHeader title="Conversions" />
              <KeyEventsPanel events={snapshot.keyEvents} />
            </section>

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
              Catharsis · web analytics · generated{" "}
              {formatBerlinDateTime(snapshot.generatedAt)} · times in {nowTz}
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
