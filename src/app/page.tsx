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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-glass min-w-0 rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className="mt-2 break-words text-2xl font-semibold text-white">{formatNumber(value)}</div>
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricTile label="Followers" value={summary.followers} />
        <MetricTile label="Impressions" value={summary.impressions} />
        <MetricTile label="Reach" value={summary.reach} />
        <MetricTile label="Profile views" value={summary.profileViews} />
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

function ScheduledPostCard({ item }: { item: ScheduledPost }) {
  return (
    <article className="card-glass overflow-hidden rounded-3xl">
      {item.preview_url ? (
        <div className="relative h-44 w-full">
          <Image src={item.preview_url} alt={item.title || "Scheduled post preview"} fill className="object-cover" unoptimized />
          <div className="absolute inset-0 bg-gradient-to-t from-[#120f22] via-transparent to-transparent" />
        </div>
      ) : (
        <div className="flex h-44 items-center justify-center bg-gradient-to-br from-[#2a1f46] to-[#171226] text-sm text-zinc-300">
          {item.post_type.toUpperCase()} POST
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.16em] text-[#cdbef0]">{item.post_type}</div>
            <h3 className="mt-2 line-clamp-3 text-lg font-semibold text-white">{item.title || item.caption || "Untitled scheduled post"}</h3>
          </div>
          <span className="soft-pill rounded-full px-3 py-1 text-xs text-[#a9ddd9]">scheduled</span>
        </div>
        <div className="mt-4 space-y-2 text-sm text-zinc-300">
          <div>{formatDate(item.scheduled_date)}</div>
          <div className="flex flex-wrap gap-2">
            {(item.platforms || []).map((platform) => (
              <span key={platform} className="soft-pill rounded-full px-3 py-1 text-xs capitalize">
                {platform}
              </span>
            ))}
          </div>
          <div className="text-xs text-zinc-500">Job ID: {item.job_id}</div>
        </div>
      </div>
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
        return sum + Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.shares || 0) + Number(metrics.saves || 0);
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

    const uniqueRequestIds = Array.from(new Set(history.map((item) => item.request_id).filter(Boolean))).slice(0, 6) as string[];
    const postAnalytics = await Promise.all(uniqueRequestIds.map((requestId) => getPostAnalytics(requestId)));
    topPosts = getTopPosts(postAnalytics);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  const recent = [...history].slice(0, 12);

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
                <p className="mt-3 text-sm text-zinc-300">Open the native Upload-Post calendar for a fuller scheduling view.</p>
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

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="card-glass rounded-[2rem] p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Scheduled content</h2>
                <p className="mt-1 text-sm text-zinc-400">Real future posts from Upload-Post schedule data</p>
              </div>
              <span className="soft-pill rounded-full px-3 py-1 text-sm text-zinc-300">{scheduledPosts.length} scheduled</span>
            </div>
            {scheduledPosts.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {scheduledPosts.slice(0, 8).map((item) => (
                  <ScheduledPostCard key={item.job_id} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-zinc-400">
                No scheduled items found yet.
              </div>
            )}
          </div>

          <div className="card-glass rounded-[2rem] p-6">
            <h2 className="text-2xl font-semibold">Catharsis feel</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-300">
              <li>• darker, softer palette instead of generic SaaS blue</li>
              <li>• glass panels and calmer contrast</li>
              <li>• calendar driven by the real schedule endpoint</li>
              <li>• room to add hook and CTA intelligence next</li>
            </ul>
          </div>
        </section>

        <section className="card-glass rounded-[2rem] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Top posts</h2>
            <span className="text-sm text-zinc-400">Latest request IDs ranked by views</span>
          </div>
          {topPosts.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {topPosts.map((post) => (
                <article key={post.requestId} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#d0bdf5]">{post.mediaType}</div>
                  <h3 className="mt-2 text-lg font-semibold text-white">{post.title}</h3>
                  <div className="mt-2 text-sm text-zinc-400">{formatDate(post.uploadedAt)}</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MetricTile label="Total views" value={post.totalViews} />
                    <MetricTile label="Engagement" value={post.totalEngagement} />
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
