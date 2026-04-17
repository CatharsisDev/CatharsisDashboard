import {
  getAnalytics,
  getHistory,
  getPostAnalytics,
  getReadOnlyCalendarUrl,
  getTotalImpressions,
  normalizeAnalytics,
  normalizeHistory,
  summarizeAnalytics,
  type AnalyticsMetric,
  type HistoryItem,
  type PostAnalyticsResponse,
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

function formatPlatforms(item: HistoryItem) {
  return item.platform || "-";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function pickScheduledItems(items: HistoryItem[]) {
  const now = Date.now();

  const upcoming = items
    .filter((item) => item.scheduled_date && new Date(item.scheduled_date).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_date || 0).getTime() - new Date(b.scheduled_date || 0).getTime());

  if (upcoming.length) return upcoming;

  return items
    .filter((item) => item.job_id)
    .sort((a, b) => new Date(b.upload_timestamp || 0).getTime() - new Date(a.upload_timestamp || 0).getTime())
    .slice(0, 8);
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/20 p-3">
      <div className="text-[11px] leading-4 text-zinc-400">{label}</div>
      <div className="mt-1 break-words text-xl font-semibold text-white">{formatNumber(value)}</div>
    </div>
  );
}

function AnalyticsCard({ metric }: { metric: AnalyticsMetric }) {
  const summary = summarizeAnalytics(metric);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold capitalize text-white">{metric.platform}</h2>
        <span className="whitespace-nowrap rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
          {metric.metric_type || "analytics"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricTile label="Followers" value={summary.followers} />
        <MetricTile label="Impressions" value={summary.impressions} />
        <MetricTile label="Reach" value={summary.reach} />
        <MetricTile label="Profile views" value={summary.profileViews} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-4">
        <span className="rounded-full bg-black/20 px-3 py-1">Likes: {formatNumber(summary.likes)}</span>
        <span className="rounded-full bg-black/20 px-3 py-1">Comments: {formatNumber(summary.comments)}</span>
        <span className="rounded-full bg-black/20 px-3 py-1">Shares: {formatNumber(summary.shares)}</span>
        <span className="rounded-full bg-black/20 px-3 py-1">Saves: {formatNumber(summary.saves)}</span>
      </div>
    </section>
  );
}

function UpcomingPostCard({ item }: { item: HistoryItem }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-3 text-sm font-semibold text-white">{item.post_title || item.post_caption || "Untitled post"}</h3>
          <p className="mt-1 text-xs text-zinc-400">{formatPlatforms(item)} · {item.media_type || "post"}</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
          {item.scheduled_date ? "scheduled" : item.status || "published"}
        </span>
      </div>
      <div className="space-y-1 text-sm text-zinc-300">
        <div>{item.scheduled_date ? `Scheduled: ${formatDate(item.scheduled_date)}` : `Last seen: ${formatDate(item.upload_timestamp)}`}</div>
        <div>Request: {item.request_id || "-"}</div>
        <div>Job: {item.job_id || "-"}</div>
      </div>
    </article>
  );
}

function RecentPostRow({ item }: { item: HistoryItem }) {
  return (
    <tr className="border-t border-white/10 align-top">
      <td className="px-4 py-3 text-white">{item.post_title || item.post_caption || "Untitled"}</td>
      <td className="px-4 py-3 text-zinc-300">{formatPlatforms(item)}</td>
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
  let analytics: AnalyticsMetric[] = [];
  let totalImpressions = 0;
  let totalImpressionsRange = "";
  let calendarUrl = "";
  let topPosts: ReturnType<typeof getTopPosts> = [];
  let error: string | null = null;

  try {
    const [historyResponse, analyticsResponse, totalImpressionsResponse, calendarResponse] = await Promise.all([
      getHistory(),
      getAnalytics(trackedPlatforms),
      getTotalImpressions(),
      getReadOnlyCalendarUrl(),
    ]);

    history = normalizeHistory(historyResponse);
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

  const scheduledItems = pickScheduledItems(history);
  const recent = [...history].slice(0, 12);

  return (
    <main className="min-h-screen bg-[#0b1020] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-300">Catharsis dashboard</p>
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">Upload-Post analytics and content calendar</h1>
            <p className="mt-2 max-w-3xl text-zinc-300">
              A private dashboard for scheduled content, upload history, and channel analytics across TikTok,
              Instagram, X, and YouTube.
            </p>
          </div>
        </header>

        {error ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">
            <div className="font-semibold">Could not load Upload-Post data</div>
            <div className="mt-1 whitespace-pre-wrap text-red-100/80">{error}</div>
            <div className="mt-3 text-red-100/80">
              Make sure <code>UPLOAD_POST_API_KEY</code> is set and the Upload-Post profile username is correct.
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 p-6">
            <div className="text-sm uppercase tracking-[0.2em] text-cyan-200">Total impressions</div>
            <div className="mt-3 text-5xl font-semibold tracking-tight">{formatNumber(totalImpressions)}</div>
            <div className="mt-2 text-sm text-zinc-300">Across Upload-Post connected platforms</div>
            <div className="mt-4 text-xs text-zinc-400">Range: {totalImpressionsRange || "-"}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Native read-only calendar</h2>
                <p className="mt-2 text-sm text-zinc-300">
                  Open Upload-Post’s native calendar view for scheduled posts, previews, and captions.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <a
                href={calendarUrl || "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Open read-only calendar
              </a>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
          {analytics.map((metric) => (
            <AnalyticsCard key={metric.platform} metric={metric} />
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Schedule snapshot</h2>
              <span className="text-sm text-zinc-400">Showing {scheduledItems.length} items</span>
            </div>
            {scheduledItems.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {scheduledItems.map((item, index) => (
                  <UpcomingPostCard key={`${item.request_id || item.job_id || index}`} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-zinc-400">
                No scheduled items found yet.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-semibold">What this v2 shows</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-300">
              <li>• Native Upload-Post read-only calendar access</li>
              <li>• Total impressions across platforms</li>
              <li>• Per-platform analytics cards with cleaner spacing</li>
              <li>• Top posts by request ID using post analytics</li>
            </ul>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Top posts</h2>
            <span className="text-sm text-zinc-400">Latest request IDs ranked by views</span>
          </div>
          {topPosts.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {topPosts.map((post) => (
                <article key={post.requestId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-cyan-200">{post.mediaType}</div>
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
                        <span key={platform} className="rounded-full bg-white/5 px-3 py-1">
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

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
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
