import {
  getAnalytics,
  getHistory,
  groupUpcomingPosts,
  normalizeAnalytics,
  normalizeHistory,
  summarizeAnalytics,
  type AnalyticsMetric,
  type HistoryItem,
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

function AnalyticsCard({ metric }: { metric: AnalyticsMetric }) {
  const summary = summarizeAnalytics(metric);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/20">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize text-white">{metric.platform}</h2>
        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
          {metric.metric_type || "analytics"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-black/20 p-3">
          <div className="text-zinc-400">Followers</div>
          <div className="mt-1 text-xl font-semibold text-white">{formatNumber(summary.followers)}</div>
        </div>
        <div className="rounded-xl bg-black/20 p-3">
          <div className="text-zinc-400">Impressions</div>
          <div className="mt-1 text-xl font-semibold text-white">{formatNumber(summary.impressions)}</div>
        </div>
        <div className="rounded-xl bg-black/20 p-3">
          <div className="text-zinc-400">Reach</div>
          <div className="mt-1 text-xl font-semibold text-white">{formatNumber(summary.reach)}</div>
        </div>
        <div className="rounded-xl bg-black/20 p-3">
          <div className="text-zinc-400">Profile views</div>
          <div className="mt-1 text-xl font-semibold text-white">{formatNumber(summary.profileViews)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
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
        <div>
          <h3 className="text-sm font-semibold text-white">{item.post_title || item.post_caption || "Untitled post"}</h3>
          <p className="mt-1 text-xs text-zinc-400">{formatPlatforms(item)} · {item.media_type || "post"}</p>
        </div>
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
          {item.status || "scheduled"}
        </span>
      </div>
      <div className="space-y-1 text-sm text-zinc-300">
        <div>Scheduled: {formatDate(item.scheduled_date)}</div>
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

export default async function Home() {
  let history: HistoryItem[] = [];
  let analytics: AnalyticsMetric[] = [];
  let error: string | null = null;

  try {
    const [historyResponse, analyticsResponse] = await Promise.all([
      getHistory(),
      getAnalytics(trackedPlatforms),
    ]);

    history = normalizeHistory(historyResponse);
    analytics = normalizeAnalytics(analyticsResponse);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  const upcoming = groupUpcomingPosts(history).slice(0, 8);
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

        <section className="grid gap-4 lg:grid-cols-4">
          {analytics.map((metric) => (
            <AnalyticsCard key={metric.platform} metric={metric} />
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Upcoming calendar</h2>
              <span className="text-sm text-zinc-400">Next {upcoming.length} scheduled items</span>
            </div>
            {upcoming.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {upcoming.map((item, index) => (
                  <UpcomingPostCard key={`${item.request_id || item.job_id || index}`} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-zinc-400">
                No upcoming scheduled posts found yet.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-semibold">What this v1 shows</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-300">
              <li>• Real Upload-Post analytics using the Catharsis profile</li>
              <li>• Upcoming scheduled posts from Upload-Post history</li>
              <li>• Recent upload history with request IDs for debugging</li>
              <li>• Ready for hook, CTA, and post-level performance panels next</li>
            </ul>
          </div>
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
