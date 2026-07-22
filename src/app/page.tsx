import ContentCalendar from "./content-calendar";
import PeriodToggle from "./_components/period-toggle";
import InfoTooltip from "./_components/info-tooltip";
import PlatformRanking from "./_components/platform-ranking";
import { parsePeriod, periodDays, periodLabel } from "@/lib/period";
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
import type { TopPost, TopPostSortKey, TopPostsRankings } from "./page-types";
import TopPostsTabs from "./_components/top-posts-tabs";

const trackedPlatforms = ["tiktok", "instagram", "x", "youtube", "pinterest"];

function formatDate(value?: string) {
  return formatBerlinDateTime(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function StatBox({
  label,
  value,
  info,
}: {
  label: React.ReactNode;
  value: number;
  /** Optional `?` tooltip rendered in the top-right corner of the card. */
  info?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-white/5 bg-black/15 p-4">
      {info ? (
        <span className="absolute right-2 top-2">
          <InfoTooltip text={info} position="bottom-start" />
        </span>
      ) : null}
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">
        {formatNumber(value)}
      </div>
    </div>
  );
}

/**
 * Smaller sibling of StatBox for secondary metrics (reach / profile views /
 * shares / saves). Same corner-badge layout so the (?) icon doesn't crowd
 * the label, but with tighter padding and smaller type so these don't
 * compete visually with the primary stats above them.
 */
function MiniStatBox({
  label,
  value,
  info,
}: {
  label: string;
  value: number;
  info?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-white/5 bg-black/15 px-3 py-2.5">
      {info ? (
        <span className="absolute right-1.5 top-1.5">
          <InfoTooltip text={info} position="bottom-start" />
        </span>
      ) : null}
      <div className="pr-5 text-[9px] uppercase tracking-[0.18em] text-[#b9a7b6]">{label}</div>
      <div className="mt-1 font-display text-lg text-[#f3e7d7]">{formatNumber(value)}</div>
    </div>
  );
}

// Tooltip copy convention across all per-platform stats: two clauses joined
// by " · ". First clause = *what the number counts* (plain English). Second
// clause = *the scope + a caveat* (which window, what's excluded, why it may
// look surprising). Keeps every hover consistent and skimmable.

const YT = /(youtube|yt)/;
const PIN = /(pin)/;
const TT = /(tiktok|tt)/;
const IG = /(insta|ig)/;
const XR = /(twitter|^x$)/;

function platformStatInfo(
  platform: string,
  stat: "followers" | "likes" | "comments" | "reach" | "profileViews" | "shares" | "saves",
): string {
  const p = platform.toLowerCase();
  const isYT = YT.test(p);
  const isPin = PIN.test(p);
  const isTT = TT.test(p);
  const isIG = IG.test(p);
  const isX = XR.test(p);

  switch (stat) {
    case "followers":
      if (isYT) return "Channel subscribers · current snapshot; anonymous subscribers included if you allow them, unsubs reflected immediately.";
      if (isPin) return "Pinterest account followers · current snapshot.";
      if (isTT) return "TikTok account followers · current snapshot; fluctuates as accounts unfollow or get banned.";
      if (isIG) return "Instagram account followers · current snapshot; doesn't count followers from linked Threads/Facebook accounts.";
      if (isX) return "X account followers · current snapshot; may exclude accounts X flagged as inauthentic.";
      return "Current follower count · always a snapshot, never period-scoped.";

    case "likes":
      if (isYT) return "'Like' button taps on your videos · summed over the platform's window; dislikes are separate and not counted here.";
      if (isPin) return "Pin 'love' reactions · over the platform's window; saves are separate (see the Saves card).";
      if (isTT) return "Hearts on your videos · over TikTok's window; one viewer can only heart a video once.";
      if (isIG) return "Likes on feed posts + reels · over the window; story reactions are tracked separately by Instagram and may not appear here.";
      if (isX) return "Likes (❤) on tweets you authored · over the window.";
      return "Sum of 'like' reactions on your posts · window varies by platform.";

    case "comments":
      if (isYT) return "Top-level comments + replies on your videos · over the window; comments you left on others' videos don't count here.";
      if (isPin) return "Comments on your pins · over the window; Pinterest comment activity is generally low.";
      if (isTT) return "Comments + replies under your videos · over the window; excludes comments hidden by your filter-words list.";
      if (isIG) return "Comments on feed posts, reels, and IGTV · over the window; story replies land in DMs and aren't counted here.";
      if (isX) return "Replies to tweets you authored · over the window; quote-tweets are counted as shares, not comments.";
      return "Comments + replies on your posts · over the window.";

    case "reach":
      return "Unique accounts that saw at least one of your posts · reach ≤ impressions because one account can be impressed many times; platforms that don't expose reach show 0.";
    case "profileViews":
      return "Visits to your profile / channel page · over the window; distinct from impressions — these are people who actively clicked through.";
    case "shares":
      if (isX) return "Retweets / reposts of your tweets · over the window.";
      if (isIG) return "External shares of feed posts + reels (DMs, Stories, off-platform links) · over the window; in-feed re-shares are counted separately.";
      return "Times someone shared your post outward (DM, repost, off-platform link) · over the window.";
    case "saves":
      if (isPin) return "Times your pin was re-pinned to another board · over the window; Pinterest's strongest engagement signal, usually higher than likes.";
      return "Times someone bookmarked/saved your post to revisit later · over the window.";
  }
}

function impressionInfo(platform: string): string {
  const p = platform.toLowerCase();
  if (TT.test(p)) return "Total video views · TikTok's rolling 7–28d window depending on API tier; loops by the same viewer can count again.";
  if (IG.test(p)) return "Times your posts + reels appeared on screen · Instagram Insights' default 7–28d window; Meta is renaming this to 'views' in newer API versions.";
  if (XR.test(p)) return "Times your tweets were rendered in feeds/search · account-wide, ~28d; free API tier returns very limited data here.";
  if (YT.test(p)) return "Channel-level lifetime views · not really 'impressions' — YouTube reserves that word for thumbnail appearances in recommendations, which requires a different scope. Expect this to be much bigger than other platforms.";
  if (PIN.test(p)) return "Times your pins appeared in home feed, search, or related-pins panels · ~30d window; a save/repin can generate fresh impressions later when the saver's followers see it.";
  if (/(facebook|fb)/.test(p)) return "Times your posts appeared on screen · Facebook's analytics window.";
  if (/(linkedin|li)/.test(p)) return "Times your posts appeared in LinkedIn feeds · account-wide.";
  if (/(thread)/.test(p)) return "Times your threads were displayed in feeds · window varies.";
  return "What 'impressions' counts varies by platform · see each platform's docs for the exact rules.";
}

function AnalyticsCard({
  metric,
  periodLabelText,
}: {
  metric: AnalyticsMetric;
  /** Active dashboard window (e.g. "last 7 days"). Platforms that honor
      windowing return numbers for this range; platforms that don't (YouTube
      lifetime, etc.) return their own default scope. */
  periodLabelText: string;
}) {
  const summary = summarizeAnalytics(metric);

  return (
    <section className="card-glass rounded-3xl p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl capitalize text-[#f3e7d7]">{metric.platform}</h2>
        <span className="pill-ember rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
          {metric.metric_type || "analytics"}
        </span>
      </div>
      {/* Make the scope explicit on each card so the user doesn't expect the
          per-platform numbers to sum to the page's headline impressions
          (they often won't — see the disclaimer in the section header). */}
      <div className="mb-4 text-[10px] uppercase tracking-[0.18em] text-[#8f7d8c]">
        Profile-level · {periodLabelText} where the platform allows it
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox
          label="Followers"
          value={summary.followers}
          info={platformStatInfo(metric.platform, "followers")}
        />
        <StatBox
          label="Impressions"
          value={summary.impressions}
          info={impressionInfo(metric.platform)}
        />
        <StatBox
          label="Likes"
          value={summary.likes}
          info={platformStatInfo(metric.platform, "likes")}
        />
        <StatBox
          label="Comments"
          value={summary.comments}
          info={platformStatInfo(metric.platform, "comments")}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStatBox
          label="Reach"
          value={summary.reach}
          info={platformStatInfo(metric.platform, "reach")}
        />
        <MiniStatBox
          label="Profile views"
          value={summary.profileViews}
          info={platformStatInfo(metric.platform, "profileViews")}
        />
        <MiniStatBox
          label="Shares"
          value={summary.shares}
          info={platformStatInfo(metric.platform, "shares")}
        />
        <MiniStatBox
          label="Saves"
          value={summary.saves}
          info={platformStatInfo(metric.platform, "saves")}
        />
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

// We compute a normalized post object once per post and then expose multiple
// rankings against the same set so the homepage can flip ranking tabs
// (views / likes / comments / engagement) instantly client-side without
// re-running these reductions.

function computeTopPosts(postAnalytics: PostAnalyticsResponse[]): TopPost[] {
  return postAnalytics
    .map((entry): TopPost => {
      const platforms = Object.entries(entry.platforms || {});
      // Per-metric helper: sum a metric across every platform on this post,
      // accepting any of a list of synonyms (Upload-Post returns different
      // keys depending on the platform — e.g. likes vs favorites).
      const sumMetric = (...keys: string[]): number =>
        platforms.reduce((sum, [, data]) => {
          const metrics = data.post_metrics || {};
          let v = 0;
          for (const k of keys) {
            const candidate = Number(metrics[k] || 0);
            if (candidate > v) v = candidate; // prefer the largest synonym hit
          }
          return sum + v;
        }, 0);

      const totalViews = sumMetric("views", "impressions", "reach");
      const totalLikes = sumMetric("likes", "favorites", "reactions");
      const totalComments = sumMetric("comments", "replies");
      const totalShares = sumMetric("shares", "reposts", "retweets");
      const totalSaves = sumMetric("saves", "bookmarks");
      // "Engagement" is the union of every interaction type — likes,
      // comments, shares, saves. Mirrors what most platform "best of"
      // signals use internally.
      const totalEngagement =
        totalLikes + totalComments + totalShares + totalSaves;

      return {
        requestId: entry.post?.request_id || "-",
        title: entry.post?.post_title || entry.post?.post_caption || "Untitled post",
        mediaType: entry.post?.media_type || "post",
        uploadedAt: entry.post?.upload_timestamp,
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        totalSaves,
        totalEngagement,
        platforms,
      };
    })
    .filter(
      (p) =>
        p.totalViews > 0 ||
        p.totalLikes > 0 ||
        p.totalComments > 0 ||
        p.totalEngagement > 0,
    );
}

function rankBy(posts: TopPost[], key: TopPostSortKey): TopPost[] {
  const metric = (p: TopPost): number => {
    switch (key) {
      case "views":
        return p.totalViews;
      case "likes":
        return p.totalLikes;
      case "comments":
        return p.totalComments;
      case "engagement":
        return p.totalEngagement;
    }
  };
  return [...posts].sort((a, b) => metric(b) - metric(a)).slice(0, 6);
}

function computeTopPostsRankings(
  postAnalytics: PostAnalyticsResponse[],
): TopPostsRankings {
  const all = computeTopPosts(postAnalytics);
  return {
    views: rankBy(all, "views"),
    likes: rankBy(all, "likes"),
    comments: rankBy(all, "comments"),
    engagement: rankBy(all, "engagement"),
  };
}

export default async function Home({
  searchParams,
}: {
  // The period toggle propagates as ?period=7d|30d|90d|365d. UploadPost's
  // analytics endpoint returns aggregated current-state metrics that aren't
  // period-scoped, so on this page the period mostly drives the recent-
  // activity table cutoff and the visible labels — the cards themselves
  // surface whatever Upload-Post returns.
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);
  // Build the cutoff from `new Date()` rather than Date.now() so the React
  // server-component purity lint stays happy — they're equivalent at runtime.
  const nowMs = new Date().getTime();
  const periodCutoffMs = nowMs - periodDays(period) * 24 * 3600 * 1000;
  // Upload-Post's /total-impressions accepts YYYY-MM-DD start/end. Pass the
  // active window so the impressions card actually responds to the toggle —
  // the API otherwise defaults to ~30 days regardless of what the UI says.
  const toYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const impressionsStart = toYmd(periodCutoffMs);
  const impressionsEnd = toYmd(nowMs);

  let history: HistoryItem[] = [];
  let scheduledPosts: Awaited<ReturnType<typeof normalizeScheduledPosts>> = [];
  let analytics: AnalyticsMetric[] = [];
  let totalImpressions = 0;
  let totalImpressionsRange = "";
  let calendarUrl = "";
  let topPostsRankings: TopPostsRankings = {
    views: [],
    likes: [],
    comments: [],
    engagement: [],
  };
  let error: string | null = null;

  try {
    const [historyResponse, scheduleResponse, analyticsResponse, totalImpressionsResponse, calendarResponse] =
      await Promise.all([
        getHistory(),
        getScheduledPosts(),
        // Same window as the /total-impressions call — Upload-Post relays the
        // date params to each platform's API where the platform supports
        // windowing. Platforms that ignore date params (YouTube lifetime,
        // some X tiers) still come back with their default scope, which is
        // why the cards may not sum to the headline impressions number.
        getAnalytics(trackedPlatforms, {
          startDate: impressionsStart,
          endDate: impressionsEnd,
        }),
        getTotalImpressions({ startDate: impressionsStart, endDate: impressionsEnd }),
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
    topPostsRankings = computeTopPostsRankings(postAnalytics);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error loading Upload-Post data";
  }

  // Filter the recent-activity table to posts uploaded inside the selected
  // window, then cap to a sane row count. Falls back to "no timestamp" rows
  // (legacy entries) when the cutoff would have hidden everything.
  const inWindow = history.filter((h) => {
    const ts = h.upload_timestamp || h.scheduled_date;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && t >= periodCutoffMs;
  });
  const recent = (inWindow.length ? inWindow : history).slice(0, 12);
  const nowTzLabel = berlinTzLabel(new Date());

  return (
    <main className="min-h-screen text-[#f3e7d7]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-12">
        {/* ---------- masthead ---------- */}
        <header className="card-glass overflow-hidden rounded-[2rem] p-8 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_0.9fr] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e7b894]/15 ring-1 ring-[#e7b894]/40">
                    <span className="h-2 w-2 rounded-full bg-[#e7b894] shadow-[0_0_16px_rgba(231,184,148,0.8)]" />
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.32em] text-[#e7b894]">Catharsis</span>
                  <span className="text-[11px] uppercase tracking-[0.24em] text-[#b9a7b6]">· rhythm + release</span>
                </div>
                <PeriodToggle active={period} basePath="/" />
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
              <div className="card-ember relative rounded-3xl p-5">
                <span className="absolute right-3 top-3">
                  <InfoTooltip
                    text={
                      // This is subtle enough to warrant a longer tooltip.
                      // The key insight — which caused hours of confusion —
                      // is that the window filters *which posts* get counted,
                      // not *which impressions on those posts* get counted.
                      // Each post contributes its lifetime view count.
                      "For every post you published in the window, this counts its current lifetime view count from the source platform, then adds them all together. A single post that went viral 6 days ago and has 1M views today contributes all 1M — even though those views accumulated over the post's whole life. So the number can be much larger than 'impressions I earned in the last 7 days' — it's really 'impressions earned by posts I published in the last 7 days, counted forever'."
                    }
                    position="bottom-start"
                  />
                </span>
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#f3d9bc]">
                  Views on recent uploads · {periodLabel(period)}
                </div>
                <div className="font-display mt-3 text-5xl tracking-tight text-[#fff3e0]">
                  {formatNumber(totalImpressions)}
                </div>
                <div className="mt-2 text-sm text-[#f3d9bc]/80">
                  Lifetime views on posts you published in this window
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-[#f3d9bc]/60">
                  <span>{totalImpressionsRange || "—"}</span>
                  {/* Escape hatch: download a per-month × per-platform CSV
                      that adds up to this number, so the aggregate can be
                      audited when it looks surprising. Route lives at
                      /api/impressions-monthly-csv. */}
                  <a
                    href="/api/impressions-monthly-csv"
                    className="rounded-full border border-[#f3d9bc]/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[#f3d9bc]/85 transition hover:bg-[#f3d9bc]/10 hover:text-[#fff3e0]"
                    title="Download a per-month × per-platform CSV breakdown of this number"
                  >
                    breakdown ↓
                  </a>
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
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">
                Per platform
              </div>
              <h2 className="font-display mt-2 text-2xl text-[#f3e7d7]">
                Platform analytics
              </h2>
            </div>
            <span className="max-w-xl text-right text-[11px] text-[#8f7d8c]">
              Profile-level snapshots per platform. Every number here is what
              that platform&apos;s API returned about your whole account — not a
              sum of your posts. Won&apos;t add up to the headline card above
              (different scope entirely), and windows vary by platform (hover
              the <span className="font-mono">?</span> on any metric for the exact rules).
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {analytics.map((metric) => (
              <AnalyticsCard
                key={metric.platform}
                metric={metric}
                periodLabelText={periodLabel(period)}
              />
            ))}
          </div>
        </section>

        {/* ---------- platform leaderboard ---------- */}
        <PlatformRanking analytics={analytics} />

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
          <TopPostsTabs rankings={topPostsRankings} />
        </section>

        {/* ---------- recent uploads ---------- */}
        <section className="card-glass rounded-[2rem] p-6 sm:p-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#e7b894]/80">History</div>
              <h2 className="font-display mt-2 text-3xl sm:text-4xl">Recent uploads</h2>
            </div>
            <span className="text-xs text-[#b9a7b6]">
              {inWindow.length ? `${recent.length} in ${periodLabel(period)}` : `Latest ${recent.length}`}
              {" "}· times in {nowTzLabel}
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
