import ContentCalendar, {
  berlinTzLabel,
  formatBerlinDateTime,
} from "./content-calendar";
import {
  getAnalytics,
  getHistory,
  getPostAnalytics,
  getReadOnlyCalendarUrl,
  getScheduledPosts,
  getTotalImpressions,
  normalizeAnalytics,
  normalizeHistory,
  normalizeScheduledPosts,
  summarizeAnalytics,
  type AnalyticsMetric,
  type HistoryItem,
  type PostAnalyticsResponse,
} from "@/lib/uploadpost";

const trackedPlatforms = ["tiktok", "instagram", "x", "youtube"];

function formatDate(value?: string) {
  return formatBerlinDateTime(value);
}

function formatMonthDay(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function buildCalendarDays(items: ScheduledPost[]) {
  return items.map((item) => ({
    ...item,
    dayLabel: formatMonthDay(item.scheduled_date),
    timeLabel: formatTime(item.scheduled_date),
  }));
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
<<<<<<< Updated upstream
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-white">{formatNumber(value)}</div>
=======
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">
        {formatNumber(value)}
      </div>
>>>>>>> Stashed changes
    </div>
  );
}

function AnalyticsCard({ metric }: { metric: AnalyticsMetric }) {
  const summary = summarizeAnalytics(metric);

  return (
    <section className="card-glass rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl capitalize text-[#f3e7d7]">{metric.platform}</h2>
        <span className="pill-ember rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
          {metric.metric_type || "analytics"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Followers" value={summary.followers} />
        <StatBox label="Impressions" value={summary.impressions} />
        <StatBox label="Reach" value={summary.reach} />
        <StatBox label="Profile views" value={summary.profileViews} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#d9c9bc] sm:grid-cols-4">
        <span className="soft-pill rounded-full px-3 py-1">Likes: {formatNumber(summary.likes)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Comments: {formatNumber(summary.comments)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Shares: {formatNumber(summary.shares)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Saves: {formatNumber(summary.saves)}</span>
      </div>
    </section>
  );
}

<<<<<<< Updated upstream
function CalendarTile({ item }: { item: ScheduledPost & { dayLabel: string; timeLabel: string } }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-[#d8c6f2]">{item.dayLabel}</div>
          <div className="mt-1 text-2xl font-semibold text-white">{item.timeLabel}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {(item.platforms || []).map((platform) => (
            <span key={platform} className="soft-pill rounded-full px-3 py-1 text-[11px] capitalize text-zinc-300">
              {platform}
            </span>
          ))}
        </div>
      </div>

      {item.preview_url ? (
        <div className="relative mb-4 h-32 overflow-hidden rounded-2xl border border-white/10">
          <Image src={item.preview_url} alt={item.title || "Preview"} fill className="object-cover" unoptimized />
        </div>
      ) : (
        <div className="mb-4 flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1d1732] text-sm uppercase tracking-[0.18em] text-zinc-400">
          {item.post_type}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#a9ddd9]">
        <span>{item.post_type}</span>
        <span>•</span>
        <span>{item.original_timezone || "UTC"}</span>
      </div>

      <h3 className="mt-3 line-clamp-3 text-base font-semibold text-white">{item.title || item.caption || "Untitled scheduled post"}</h3>
      {(item.description || item.caption) && (
        <p className="mt-2 line-clamp-4 text-sm text-zinc-400">{item.description || item.caption}</p>
      )}

      <div className="mt-4 text-xs text-zinc-500">Job ID: {item.job_id}</div>
    </article>
  );
}

=======
>>>>>>> Stashed changes
function RecentPostRow({ item }: { item: HistoryItem }) {
  return (
    <tr className="border-t border-white/5 align-top">
      <td className="px-4 py-3 text-[#f3e7d7]">{item.post_title || item.post_caption || "Untitled"}</td>
      <td className="px-4 py-3 capitalize text-[#d9c9bc]">{item.platform || "—"}</td>
      <td className="px-4 py-3 text-[#d9c9bc]">{item.status || "—"}</td>
      <td className="px-4 py-3 font-mono text-xs tabular-nums text-[#d9c9bc]">
        {formatDate(item.upload_timestamp || item.scheduled_date)}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-[#8f7d8c]">{item.request_id || "—"}</td>
    </tr>
  );
}

function getTopPosts(postAnalytics: PostAnalyticsResponse[]) {
  return postAnalytics
    .map((entry) => {
      const platforms = Object.entries(entry.platforms || {});
      const totalViews = platforms.reduce((sum, [, data]) => {
        const metrics = data.post_metrics || {};
        return sum + Number(metrics.views || metrics.impressions || metrics.reach || 0);
      }, 0);
      const totalEngagement = platforms.reduce((sum, [, data]) => {
        const metrics = data.post_metrics || {};
<<<<<<< Updated upstream
        return sum + Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.shares || 0) + Number(metrics.saves || 0) + Number(metrics.favorites || 0);
=======
        return (
          sum +
          Number(metrics.likes || 0) +
          Number(metrics.comments || 0) +
          Number(metrics.shares || 0) +
          Number(metrics.saves || 0)
        );
>>>>>>> Stashed changes
      }, 0);

      return {
        requestId: entry.post?.request_id || "-",
        title: entry.post?.post_title || entry.post?.post_caption || "Untitled post",
        mediaType: entry.post?.media_type || "post",
        uploadedAt: entry.post?.upload_timestamp,
        totalViews,
        totalEngagement,
        platforms,
      };
    })
    .filter((post) => post.totalViews > 0 || post.totalEngagement > 0)
    .sort((a, b) => b.totalViews - a.totalViews)
    .slice(0, 6);
}

export default async function Home() {
  let history: HistoryItem[] = [];
  let scheduledPosts: Awaited<ReturnType<typeof normalizeScheduledPosts>> = [];
  let analytics: AnalyticsMetric[] = [];
  let totalImpressions = 0;
  let totalImpressionsRange = "";
  let calendarUrl = "";
  let topPosts: ReturnType<typeof getTopPosts> = [];
  let error: string | null = null;

  try {
    const [historyResponse, scheduleResponse, analyticsResponse, totalImpressionsResponse, calendarResponse] =
      await Promise.all([
        getHistory(),
        getScheduledPosts(),
        getAnalytics(trackedPlatforms),
        getTotalImpressions(),
        getReadOnlyCalendarUrl(),
      ]);

    history = normalizeHistory(historyResponse);
    scheduledPosts = normalizeScheduledPosts(scheduleResponse);
    analytics = normalizeAnalytics(analyticsResponse);
    totalImpressions = totalImpressionsResponse.total_impressions || 0;
    totalImpressionsRange = `${totalImpressionsResponse.start_date} → ${totalImpressionsResponse.end_date}`;
    calendarUrl = calendarResponse.access_url;

<<<<<<< Updated upstream
    const uniqueRequestIds = Array.from(new Set(history.map((item) => item.request_id).filter(Boolean))).slice(0, 12) as string[];
    const postAnalytics = await Promise.all(uniqueRequestIds.map((requestId) => getPostAnalytics(requestId)));
=======
    const uniqueRequestIds = Array.from(
      new Set(history.map((item) => item.request_id).filter(Boolean)),
    ).slice(0, 6) as string[];
    const postAnalytics = await Promise.all(
      uniqueRequestIds.map((requestId) => getPostAnalytics(requestId)),
    );
>>>>>>> Stashed changes
    topPosts = getTopPosts(postAnalytics);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  const recent = [...history].slice(0, 12);
<<<<<<< Updated upstream
  const calendarDays = buildCalendarDays(scheduledPosts);
=======
  const nowTzLabel = berlinTzLabel(new Date());
>>>>>>> Stashed changes

  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-12">
        {/* ---------- masthead ---------- */}
        <header className="card-glass overflow-hidden rounded-[2rem] p-8 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_0.9fr] lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e7b894]/15 ring-1 ring-[#e7b894]/40">
                  <span className="h-2 w-2 rounded-full bg-[#e7b894] shadow-[0_0_16px_rgba(231,184,148,0.8)]" />
                </span>
                <span className="text-[11px] uppercase tracking-[0.32em] text-[#e7b894]">Catharsis</span>
                <span className="text-[11px] uppercase tracking-[0.24em] text-[#b9a7b6]">· rhythm + release</span>
              </div>
              <h1 className="font-display mt-6 text-5xl leading-[1.02] tracking-tight sm:text-6xl">
                A softer place for
                <span className="italic text-[#e7b894]"> the work</span> behind the work.
              </h1>
              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[#d9c9bc]">
                Track performance, see what is scheduled next, and keep the Catharsis publishing
                system grounded in one calm place. All times in Europe/Berlin ({nowTzLabel}).
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card-ember rounded-3xl p-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#f3d9bc]">
                  Total impressions
                </div>
                <div className="font-display mt-3 text-5xl tracking-tight text-[#fff3e0]">
                  {formatNumber(totalImpressions)}
                </div>
                <div className="mt-2 text-sm text-[#f3d9bc]/80">Across connected platforms</div>
                <div className="mt-4 font-mono text-[11px] tabular-nums text-[#f3d9bc]/60">
                  {totalImpressionsRange || "—"}
                </div>
              </div>
              <div className="card-glass rounded-3xl p-5">
<<<<<<< Updated upstream
                <div className="text-sm uppercase tracking-[0.18em] text-[#a9ddd9]">Calendar access</div>
                <p className="mt-3 text-sm text-zinc-300">Open the native Upload-Post calendar if you want the official full calendar view.</p>
=======
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#b489c7]">
                  Native calendar
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#d9c9bc]">
                  Open the Upload-Post calendar for a deeper scheduling view.
                </p>
>>>>>>> Stashed changes
                <a
                  href={calendarUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#f3e7d7] px-5 py-3 text-sm font-medium text-[#2a1220] transition hover:bg-[#fff3e0]"
                >
                  Open read-only calendar
                  <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <section className="rounded-2xl border border-[#e88a8a]/30 bg-[#e88a8a]/10 p-5 text-sm text-[#ffd7d7]">
            <div className="font-semibold">Could not load Upload-Post data</div>
            <div className="mt-1 whitespace-pre-wrap text-[#ffd7d7]/80">{error}</div>
          </section>
        ) : null}

        {/* ---------- per-platform analytics ---------- */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {analytics.map((metric) => (
            <AnalyticsCard key={metric.platform} metric={metric} />
          ))}
        </section>

<<<<<<< Updated upstream
        <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="card-glass rounded-[2rem] p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Schedule calendar</h2>
                <p className="mt-1 text-sm text-zinc-400">A custom calendar view built from the real Upload-Post schedule endpoint</p>
              </div>
              <span className="soft-pill rounded-full px-3 py-1 text-sm text-zinc-300">{scheduledPosts.length} scheduled</span>
            </div>
            {calendarDays.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {calendarDays.map((item) => (
                  <CalendarTile key={item.job_id} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-zinc-400">
                No scheduled items found yet.
              </div>
            )}
          </div>

          <div className="card-glass rounded-[2rem] p-6">
            <h2 className="text-2xl font-semibold">Overview</h2>
            <div className="mt-5 space-y-4 text-sm text-zinc-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[#a9ddd9]">Scheduled posts</div>
                <div className="mt-2 text-3xl font-semibold text-white">{formatNumber(scheduledPosts.length)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[#a9ddd9]">Recent uploads</div>
                <div className="mt-2 text-3xl font-semibold text-white">{formatNumber(recent.length)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-zinc-400">
                Next good upgrade: platform-colored badges and post detail drawers.
              </div>
            </div>
          </div>
        </section>

        <section className="card-glass rounded-[2rem] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Top posts</h2>
            <span className="text-sm text-zinc-400">Posts with real post-level analytics</span>
=======
        {/* ---------- content calendar ---------- */}
        <ContentCalendar posts={scheduledPosts} />

        {/* ---------- top posts ---------- */}
        <section className="card-glass rounded-[2rem] p-6 sm:p-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">Signal</div>
              <h2 className="font-display mt-2 text-3xl sm:text-4xl">Top posts</h2>
            </div>
            <span className="text-xs text-[#b9a7b6]">Latest request IDs · ranked by views</span>
>>>>>>> Stashed changes
          </div>
          {topPosts.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {topPosts.map((post) => (
                <article
                  key={post.requestId}
                  className="rounded-3xl border border-white/5 bg-black/15 p-5"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#b489c7]">
                    {post.mediaType}
                  </div>
                  <h3 className="font-display mt-2 text-xl text-[#f3e7d7]">{post.title}</h3>
                  <div className="mt-2 font-mono text-xs tabular-nums text-[#b9a7b6]">
                    {formatDate(post.uploadedAt)}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <StatBox label="Total views" value={post.totalViews} />
                    <StatBox label="Engagement" value={post.totalEngagement} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#d9c9bc]">
                    {post.platforms.map(([platform, data]) => {
                      const metrics = data.post_metrics || {};
                      const views = Number(
                        metrics.views || metrics.impressions || metrics.reach || 0,
                      );
                      return (
                        <span
                          key={platform}
                          className="soft-pill rounded-full px-3 py-1 capitalize"
                        >
                          {platform}: {formatNumber(views)}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-3 font-mono text-[10px] text-[#8f7d8c]">
                    req · {post.requestId}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[#b9a7b6]">
              No post analytics available yet.
            </div>
          )}
        </section>

        {/* ---------- recent uploads ---------- */}
        <section className="card-glass rounded-[2rem] p-6 sm:p-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">History</div>
              <h2 className="font-display mt-2 text-3xl sm:text-4xl">Recent uploads</h2>
            </div>
            <span className="text-xs text-[#b9a7b6]">
              Latest {recent.length} · times in {nowTzLabel}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-black/10">
            <div className="overflow-x-auto cathars-scroll">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.18em] text-[#b9a7b6]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">When ({nowTzLabel})</th>
                    <th className="px-4 py-3 font-medium">Request ID</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item, index) => (
                    <RecentPostRow key={`${item.request_id || item.job_id || index}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <footer className="pb-4 text-center text-[11px] uppercase tracking-[0.28em] text-[#8f7d8c]">
          Catharsis · internal dashboard
        </footer>
      </div>
    </main>
  );
}
