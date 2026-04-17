import Image from "next/image";
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
  type ScheduledPost,
} from "@/lib/uploadpost";

const trackedPlatforms = ["tiktok", "instagram", "x", "youtube"];

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
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
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-white">{formatNumber(value)}</div>
    </div>
  );
}

function AnalyticsCard({ metric }: { metric: AnalyticsMetric }) {
  const summary = summarizeAnalytics(metric);

  return (
    <section className="card-glass rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold capitalize text-white">{metric.platform}</h2>
        <span className="soft-pill whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium text-[#dbcdf8]">
          {metric.metric_type || "analytics"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Followers" value={summary.followers} />
        <StatBox label="Impressions" value={summary.impressions} />
        <StatBox label="Reach" value={summary.reach} />
        <StatBox label="Profile views" value={summary.profileViews} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-4">
        <span className="soft-pill rounded-full px-3 py-1">Likes: {formatNumber(summary.likes)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Comments: {formatNumber(summary.comments)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Shares: {formatNumber(summary.shares)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Saves: {formatNumber(summary.saves)}</span>
      </div>
    </section>
  );
}

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

function RecentPostRow({ item }: { item: HistoryItem }) {
  return (
    <tr className="border-t border-white/10 align-top">
      <td className="px-4 py-3 text-white">{item.post_title || item.post_caption || "Untitled"}</td>
      <td className="px-4 py-3 text-zinc-300">{item.platform || "-"}</td>
      <td className="px-4 py-3 text-zinc-300">{item.status || "-"}</td>
      <td className="px-4 py-3 text-zinc-300">{formatDate(item.upload_timestamp || item.scheduled_date)}</td>
      <td className="px-4 py-3 text-zinc-400">{item.request_id || "-"}</td>
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
        return sum + Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.shares || 0) + Number(metrics.saves || 0) + Number(metrics.favorites || 0);
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
  let scheduledPosts: ScheduledPost[] = [];
  let analytics: AnalyticsMetric[] = [];
  let totalImpressions = 0;
  let totalImpressionsRange = "";
  let calendarUrl = "";
  let topPosts: ReturnType<typeof getTopPosts> = [];
  let error: string | null = null;

  try {
    const [historyResponse, scheduleResponse, analyticsResponse, totalImpressionsResponse, calendarResponse] = await Promise.all([
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

    const uniqueRequestIds = Array.from(new Set(history.map((item) => item.request_id).filter(Boolean))).slice(0, 12) as string[];
    const postAnalytics = await Promise.all(uniqueRequestIds.map((requestId) => getPostAnalytics(requestId)));
    topPosts = getTopPosts(postAnalytics);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  const recent = [...history].slice(0, 12);
  const calendarDays = buildCalendarDays(scheduledPosts);

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <header className="card-glass overflow-hidden rounded-[2rem] p-8">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-[#d9c5ff]">Catharsis analytics</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">A softer dashboard for content, growth, and rhythm.</h1>
              <p className="mt-4 max-w-2xl text-zinc-300">
                Track performance, see what is scheduled next, and keep the Catharsis publishing system grounded in one calm place.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card-glass rounded-3xl p-5">
                <div className="text-sm uppercase tracking-[0.18em] text-[#a9ddd9]">Total impressions</div>
                <div className="mt-3 text-5xl font-semibold tracking-tight">{formatNumber(totalImpressions)}</div>
                <div className="mt-2 text-sm text-zinc-300">Across connected platforms</div>
                <div className="mt-4 text-xs text-zinc-500">{totalImpressionsRange || "-"}</div>
              </div>
              <div className="card-glass rounded-3xl p-5">
                <div className="text-sm uppercase tracking-[0.18em] text-[#a9ddd9]">Calendar access</div>
                <p className="mt-3 text-sm text-zinc-300">Open the native Upload-Post calendar if you want the official full calendar view.</p>
                <a
                  href={calendarUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center rounded-full bg-[#e8dbff] px-5 py-3 text-sm font-semibold text-[#231833] transition hover:bg-[#f2eaff]"
                >
                  Open read-only calendar
                </a>
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">
            <div className="font-semibold">Could not load Upload-Post data</div>
            <div className="mt-1 whitespace-pre-wrap text-red-100/80">{error}</div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
          {analytics.map((metric) => (
            <AnalyticsCard key={metric.platform} metric={metric} />
          ))}
        </section>

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
          </div>
          {topPosts.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {topPosts.map((post) => (
                <article key={post.requestId} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#d0bdf5]">{post.mediaType}</div>
                  <h3 className="mt-2 text-lg font-semibold text-white">{post.title}</h3>
                  <div className="mt-2 text-sm text-zinc-400">{formatDate(post.uploadedAt)}</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <StatBox label="Total views" value={post.totalViews} />
                    <StatBox label="Engagement" value={post.totalEngagement} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
                    {post.platforms.map(([platform, data]) => {
                      const metrics = data.post_metrics || {};
                      const views = Number(metrics.views || metrics.impressions || metrics.reach || 0);
                      return (
                        <span key={platform} className="soft-pill rounded-full px-3 py-1">
                          {platform}: {formatNumber(views)}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-xs text-zinc-500">Request ID: {post.requestId}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-zinc-400">
              No post analytics available yet.
            </div>
          )}
        </section>

        <section className="card-glass rounded-[2rem] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Recent uploads</h2>
            <span className="text-sm text-zinc-400">Latest {recent.length} items</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-black/20 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">When</th>
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
      </div>
    </main>
  );
}
