import ContentCalendar from "./content-calendar";
import PeriodToggle from "./_components/period-toggle";
import InfoTooltip from "./_components/info-tooltip";
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

function StatBox({ label, value }: { label: React.ReactNode; value: number }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#b9a7b6]">{label}</div>
      <div className="mt-2 break-words font-display text-3xl text-[#f3e7d7]">
        {formatNumber(value)}
      </div>
    </div>
  );
}

/**
 * Per-platform explanation of what shows up under "Impressions" on each
 * card. Each platform's API defines this slightly differently, so the
 * tooltip clarifies what the number actually represents.
 */
/**
 * Per-platform tooltip text for non-impression stats — followers, likes,
 * comments, reach, profile views, shares, saves. Each definition is short
 * enough to live in one branch of the switch but specific enough to clear
 * up the most common questions ("why is X smaller / bigger than expected
 * here?").
 */
function platformStatInfo(
  platform: string,
  stat: "followers" | "likes" | "comments" | "reach" | "profileViews" | "shares" | "saves",
): string {
  const p = platform.toLowerCase();
  const isYouTube = /(youtube|yt)/.test(p);
  const isPinterest = /(pin)/.test(p);
  const isTikTok = /(tiktok|tt)/.test(p);
  const isInsta = /(insta|ig)/.test(p);
  const isX = /(twitter|^x$)/.test(p);

  switch (stat) {
    case "followers":
      if (isYouTube) return "Channel subscriber count. Unsubscribes and account deletions are reflected immediately. Includes anonymous subscribers if your channel allows them.";
      if (isPinterest) return "Pinterest account follower count, current snapshot.";
      if (isTikTok) return "TikTok account follower count, current snapshot — fluctuates as accounts unfollow or get banned.";
      if (isInsta) return "Instagram account follower count, current snapshot. Doesn't include followers from linked Threads/Facebook accounts.";
      if (isX) return "X account follower count. May exclude accounts X has flagged as inauthentic.";
      return "Current account follower count — always a snapshot, not period-scoped.";

    case "likes":
      if (isYouTube) return "Sum of 'like' button taps across all videos in the window. YouTube's API doesn't separate likes from dislikes here.";
      if (isPinterest) return "Pin 'love' reactions over the window. Saves count separately (see the 'Saves' pill).";
      if (isTikTok) return "Hearts on posts in the window. One viewer can heart a post once.";
      if (isInsta) return "Likes on feed posts and reels in the window. Story reactions count separately on Instagram's API and may not be included here.";
      if (isX) return "Likes (heart taps) on tweets you authored in the window.";
      return "Total 'like' reactions across posts in the window — counting rules vary by platform.";

    case "comments":
      if (isYouTube) return "Top-level comments + replies on videos in the window. Comments you posted on others' videos don't count.";
      if (isPinterest) return "Comments left on your pins. Pinterest comment activity is generally lower than on other platforms.";
      if (isTikTok) return "Comments + replies under videos in the window. Doesn't include comments hidden by the filter words list.";
      if (isInsta) return "Comments on feed posts, reels, and IGTV in the window. Story replies are separate (DMs) and not counted here.";
      if (isX) return "Replies to tweets you authored in the window. Quote-tweets are separate.";
      return "Total comments/replies on posts in the window.";

    case "reach":
      return "Unique accounts that saw your content at least once. Reach ≤ Impressions because a single account can be impressed multiple times. Some platforms don't expose reach via API and will show 0 here.";
    case "profileViews":
      return "Profile/channel page visits in the window. A different signal from impressions — these are people who actively clicked through to your profile.";
    case "shares":
      if (isX) return "Retweets/reposts of your tweets in the window.";
      if (isInsta) return "External shares of feed posts/reels (DMs, Stories, off-platform). Doesn't include in-feed reshares.";
      return "Times someone shared your post outward (DM, repost, off-platform link).";
    case "saves":
      if (isPinterest) return "Times your pin was re-pinned to another board. Pinterest's primary engagement signal — usually higher than likes.";
      return "Times someone saved your post to revisit later (bookmarks/saves).";
  }
}

function impressionInfo(platform: string): string {
  const p = platform.toLowerCase();
  if (/(tiktok|tt)/.test(p)) {
    return "Total video views in TikTok's analytics window (7–28 days). Loops by the same viewer can count again.";
  }
  if (/(insta|ig)/.test(p)) {
    return "Times your content appeared on screen in IG Insights' default window (7 or 28 days). Meta is renaming this to 'views' in newer API versions.";
  }
  if (/(twitter|^x$)/.test(p)) {
    return "Times your tweets were rendered in feeds or search results, account-wide over the last ~28 days. Free API tier returns very little.";
  }
  if (/(youtube|yt)/.test(p)) {
    return "Despite the label, this is channel-level lifetime views — YouTube reserves 'impressions' for thumbnail appearances in recommendations, which requires a different API scope. Expect this number to be much bigger than the others.";
  }
  if (/(pin)/.test(p)) {
    return "Times your pins appeared in home feeds, search results, or related-pins panels over a ~30-day window. Saves/repins generate new impressions when seen by the saver's followers.";
  }
  if (/(facebook|fb)/.test(p)) {
    return "Times your posts appeared on screen in Facebook's analytics window.";
  }
  if (/(linkedin|li)/.test(p)) {
    return "Times your posts appeared in LinkedIn feeds, account-wide.";
  }
  if (/(thread)/.test(p)) {
    return "Times your threads were displayed in feeds.";
  }
  return "What 'impressions' counts varies by platform — see each platform's analytics docs for their exact definition.";
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
        Followers = snapshot · others = {periodLabelText} (where platform supports it)
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox
          label={
            <>
              Followers
              <InfoTooltip text={platformStatInfo(metric.platform, "followers")} />
            </>
          }
          value={summary.followers}
        />
        <StatBox
          label={
            <>
              Impressions
              <InfoTooltip text={impressionInfo(metric.platform)} />
            </>
          }
          value={summary.impressions}
        />
        <StatBox
          label={
            <>
              Likes
              <InfoTooltip text={platformStatInfo(metric.platform, "likes")} />
            </>
          }
          value={summary.likes}
        />
        <StatBox
          label={
            <>
              Comments
              <InfoTooltip text={platformStatInfo(metric.platform, "comments")} />
            </>
          }
          value={summary.comments}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#d9c9bc] sm:grid-cols-4">
        <span className="soft-pill flex items-center rounded-full px-3 py-1">
          Reach: {formatNumber(summary.reach)}
          <InfoTooltip text={platformStatInfo(metric.platform, "reach")} />
        </span>
        <span className="soft-pill flex items-center rounded-full px-3 py-1">
          Profile views: {formatNumber(summary.profileViews)}
          <InfoTooltip text={platformStatInfo(metric.platform, "profileViews")} />
        </span>
        <span className="soft-pill flex items-center rounded-full px-3 py-1">
          Shares: {formatNumber(summary.shares)}
          <InfoTooltip text={platformStatInfo(metric.platform, "shares")} />
        </span>
        <span className="soft-pill flex items-center rounded-full px-3 py-1">
          Saves: {formatNumber(summary.saves)}
          <InfoTooltip text={platformStatInfo(metric.platform, "saves")} />
        </span>
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
              <div className="card-ember rounded-3xl p-5">
                <div className="flex items-center text-[10px] uppercase tracking-[0.22em] text-[#f3d9bc]">
                  Impressions · {periodLabel(period)}
                  <InfoTooltip
                    text="Sum of every post you published in this window, multiplied by each post's impression count from its source platform. Different from the per-platform 'Impressions' cards below, which show platform-defined profile-level numbers and may not sum to this value."
                    position="right"
                  />
                </div>
                <div className="font-display mt-3 text-5xl tracking-tight text-[#fff3e0]">
                  {formatNumber(totalImpressions)}
                </div>
                <div className="mt-2 text-sm text-[#f3d9bc]/80">
                  Post-level sum across connected platforms
                </div>
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
              Each platform&apos;s API defines &ldquo;impressions&rdquo; differently —
              some honor the {periodLabel(period)} window, some return their own
              default scope (e.g. YouTube&apos;s lifetime view count). That&apos;s
              why these don&apos;t always add up to the headline impressions number.
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
