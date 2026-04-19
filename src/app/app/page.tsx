import Link from "next/link";
import { getProvider } from "@/lib/analytics";
import type {
  AppMeta,
  AppSnapshot,
  PerformanceMetric,
  RatingsSummary,
  Review,
  TimeSeriesStats,
} from "@/lib/analytics/types";
import { berlinTzLabel, formatBerlinDateTime } from "@/lib/tz";

export const dynamic = "force-dynamic";

// ---- small helpers ------------------------------------------------------
function formatNumber(v: number) {
  return new Intl.NumberFormat("en-GB").format(Math.round(v));
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

// ---- installs bar chart (inline SVG, no deps) ---------------------------
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

// ---- sections -----------------------------------------------------------
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

function RatingsPanel({ ratings }: { ratings: RatingsSummary | undefined }) {
  if (!ratings) {
    return (
      <div className="card-glass rounded-3xl p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Ratings</div>
        <div className="mt-3 text-[#b9a7b6]">No ratings yet. They&rsquo;ll appear here once reviewers start arriving.</div>
      </div>
    );
  }
  const distribution = ratings.distribution;
  const max = distribution ? Math.max(1, ...Object.values(distribution)) : 1;
  return (
    <div className="card-glass rounded-3xl p-6">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Ratings</div>
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
    </div>
  );
}

function PerformancePanel({
  metrics,
  crashes,
}: {
  metrics: PerformanceMetric[] | undefined;
  crashes: AppSnapshot["crashes"];
}) {
  if ((!metrics || !metrics.length) && !crashes) {
    return (
      <div className="card-glass rounded-3xl p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Performance</div>
        <div className="mt-3 text-[#b9a7b6]">
          Apple only publishes perf &amp; power metrics once the app has enough active devices. Check back after more installs.
        </div>
      </div>
    );
  }
  const headline: PerformanceMetric[] = (metrics || []).slice(0, 8);
  return (
    <div className="card-glass rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Performance</div>
        <span className="text-xs text-[#b9a7b6]">iPhone · all devices</span>
      </div>
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
    </div>
  );
}

function InstallsPanel({ installs }: { installs: TimeSeriesStats | undefined }) {
  if (!installs) {
    return (
      <div className="card-glass rounded-3xl p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Installs</div>
        <div className="mt-3 text-[#b9a7b6]">
          Set <code className="font-mono text-[#f3d9bc]">APPSTORE_VENDOR_NUMBER</code> to enable daily download counts from the Sales &amp; Trends API.
        </div>
      </div>
    );
  }
  const avg = installs.total / Math.max(1, installs.points.length);
  return (
    <div className="card-glass rounded-3xl p-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Installs</div>
          <div className="font-display mt-2 text-4xl">{formatNumber(installs.total)}</div>
          <div className="mt-1 text-xs text-[#b9a7b6]">
            last {installs.points.length} days · avg {formatNumber(avg)}/day
          </div>
        </div>
        <div className="text-right text-xs text-[#8f7d8c]">via Sales &amp; Trends · daily</div>
      </div>
      <div className="mt-5">
        <InstallsChart data={installs} />
      </div>
    </div>
  );
}

function ReviewsPanel({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) {
    return (
      <div className="card-glass rounded-3xl p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#e7b894]/80">Reviews</div>
        <div className="mt-3 text-[#b9a7b6]">No reviews yet.</div>
      </div>
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

function SetupState() {
  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="card-glass rounded-[2rem] p-10">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">
            Mobile analytics
          </div>
          <h1 className="font-display mt-3 text-4xl">Connect App Store Connect</h1>
          <p className="mt-4 text-[#d9c9bc]">
            This page reads analytics directly from the App Store Connect API. Add these env vars to
            <code className="mx-1 rounded bg-black/30 px-1 font-mono text-[#f3d9bc]">.env.local</code>
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
              <span className="font-mono text-[#f3d9bc]">APPSTORE_VENDOR_NUMBER</span> <span className="text-[#8f7d8c]">(optional)</span> — enables daily install counts from the Sales &amp; Trends API.
            </li>
          </ul>
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
export default async function AppAnalyticsPage() {
  const provider = getProvider("ios");
  if (!provider || !provider.isConfigured()) {
    return <SetupState />;
  }

  let snapshot: AppSnapshot | null = null;
  let error: string | null = null;

  try {
    const apps = await provider.listApps();
    const preferredId = process.env.APPSTORE_APP_ID;
    const chosen = apps.find((a) => a.id === preferredId) || apps[0];
    if (!chosen) {
      error =
        "The API key is valid but no apps are visible to it. In App Store Connect, give this key access to at least one app.";
    } else {
      snapshot = await provider.fetchSnapshot(chosen.id);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error contacting App Store Connect";
  }

  const nowTz = berlinTzLabel(new Date());

  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        {snapshot ? (
          <header className="card-glass rounded-[2rem] p-8 sm:p-10">
            <AppHeader app={snapshot.app} platformName={provider.displayName} />
            <div className="mt-6 grid gap-4 md:grid-cols-3">
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
                label="Installs (last 7d)"
                value={snapshot.installs ? formatNumber(snapshot.installs.total) : "—"}
                sub={snapshot.installs ? "Sales & Trends" : "vendor # not set"}
              />
              <MetricTile
                label="Warnings"
                value={String(snapshot.warnings.length)}
                sub="see below"
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
            <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
              <RatingsPanel ratings={snapshot.ratings} />
              <InstallsPanel installs={snapshot.installs} />
            </section>

            <PerformancePanel metrics={snapshot.performance} crashes={snapshot.crashes} />

            <ReviewsPanel reviews={snapshot.reviews} />

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
