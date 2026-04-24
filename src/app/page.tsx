import ContentCalendar from "./content-calendar";
import { berlinTzLabel, formatBerlinDateTime } from "@/lib/tz";

// `cache: "no-store"` is already set on every Upload-Post fetch, but pin the
// route as dynamic too so Next.js never serves a stale rendered HTML payload —
// the calendar's Refresh button calls `router.refresh()` and needs a guaranteed
// fresh server render to pick up posts that were just scheduled in Upload-Post.
export const dynamic = "force-dynamic";
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

const trackedPlatforms = ["tiktok", "instagram", "x", "youtube", "pinterest"];

function formatDate(value?: string) {
  return formatBerlinDateTime(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">
        {formatNumber(value)}
      </div>
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
        <StatBox label="Likes" value={summary.likes} />
        <StatBox label="Comments" value={summary.comments} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#d9c9bc] sm:grid-cols-4">
        <span className="soft-pill rounded-full px-3 py-1">Reach: {formatNumber(summary.reach)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Profile views: {formatNumber(summary.profileViews)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Shares: {formatNumber(summary.shares)}</span>
        <span className="soft-pill rounded-full px-3 py-1">Saves: {formatNumber(summary.saves)}</span>
      </div>
    </section>
  );
}

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
        return (
          sum +
          Number(metrics.likes || 0) +
          Number(metrics.comments || 0) +
          Number(metrics.shares || 0) +
          Number(metrics.saves || 0) +
          Number(metrics.favorites || 0)
        );
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

    const uniqueRequestIds = Array.from(
      new Set(history.map((item) => item.request_id).filter(Boolean)),
    ).slice(0, 12) as string[];
    const postAnalytics = await Promise.all(
      uniqueRequestIds.map((requestId) => getPostAnalytics(requestId)),
    );
    topPosts = getTopPosts(postAnalytics);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  const recent = [...history].slice(0, 12);
  const nowTzLabel = berlinTzLabel(new Date());

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
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#b489c7]">
                  Native calendar
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#d9c9bc]">
                  Open the Upload-Post calendar for a deeper scheduling view.
                </p>
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

        {/* ---------- content calendar ---------- */}
        <ContentCalendar posts={scheduledPosts} />

        {/* ---------- top posts ---------- */}
        <section className="card-glass rounded-[2rem] p-6 sm:p-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">Signal</div>
              <h2 className="font-display mt-2 text-3xl sm:text-4xl">Top posts</h2>
            </div>
            <span className="text-xs text-[#b9a7b6]">Posts with real post-level analytics</span>
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
