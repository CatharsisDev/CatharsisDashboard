const API_BASE = process.env.UPLOAD_POST_API_BASE || "https://api.upload-post.com/api";
const API_KEY = process.env.UPLOAD_POST_API_KEY;
const PROFILE_USERNAME = process.env.UPLOAD_POST_PROFILE_USERNAME || "catharsis";
const CALENDAR_TITLE = process.env.UPLOAD_POST_CALENDAR_TITLE || "Catharsis Content Calendar";
const CALENDAR_LOGO = process.env.UPLOAD_POST_CALENDAR_LOGO || "";

function getHeaders() {
  if (!API_KEY) {
    throw new Error("Missing UPLOAD_POST_API_KEY environment variable");
  }

  return {
    Authorization: `Apikey ${API_KEY}`,
    Accept: "application/json",
  };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload-Post API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export type AnalyticsMetric = {
  platform: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  profileViews?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  metric_type?: string;
  primary_impressions_field?: string;
  available_metrics?: string[];
  reach_timeseries?: Array<{ date: string; value: number }>;
  // Upload-Post's response shape drifts by platform — Pinterest returns
  // `follower_count`, YouTube uses `view_count`, some platforms nest
  // `insights.impressions`. Keep an index signature so summarizeAnalytics
  // can fall back to any of those without TypeScript complaining.
  [key: string]: unknown;
};

export type AnalyticsResponse = Record<string, Omit<AnalyticsMetric, "platform">>;

export type HistoryItem = {
  request_id?: string;
  job_id?: string;
  profile_username?: string;
  platform?: string;
  media_type?: string;
  upload_timestamp?: string;
  scheduled_date?: string;
  success?: boolean;
  post_url?: string;
  post_title?: string;
  post_caption?: string;
  status?: string;
  [key: string]: unknown;
};

export type HistoryResponse = {
  history?: HistoryItem[];
  [key: string]: unknown;
};

export type ScheduledPost = {
  job_id: string;
  scheduled_date: string;
  post_type: string;
  profile_username: string;
  title?: string;
  caption?: string;
  description?: string;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  platforms?: string[];
  original_timezone?: string;
  original_scheduled_str?: string;
  platform_content?: Record<string, { title?: string; caption?: string }>;
};

export type ScheduleResponse = {
  scheduled_posts?: ScheduledPost[];
};

export type TotalImpressionsResponse = {
  success: boolean;
  profile_username: string;
  start_date: string;
  end_date: string;
  total_impressions: number;
};

export type PlatformPostAnalytics = {
  success?: boolean;
  platform_post_id?: string;
  post_url?: string;
  post_metrics?: Record<string, number>;
  profile_snapshot_latest?: Record<string, number>;
  profile_snapshot_at_post_date?: Record<string, number>;
  profile_snapshot_latest_date?: string;
};

export type PostAnalyticsResponse = {
  success: boolean;
  post?: {
    request_id?: string;
    profile_username?: string;
    post_title?: string;
    post_caption?: string;
    media_type?: string;
    upload_timestamp?: string;
  };
  platforms?: Record<string, PlatformPostAnalytics>;
};

export type CalendarJwtResponse = {
  success: boolean;
  access_url: string;
  duration?: string;
};

export async function getHistory() {
  return fetchJson<HistoryResponse>("/uploadposts/history");
}

export async function getScheduledPosts() {
  return fetchJson<ScheduleResponse>("/uploadposts/schedule");
}

/**
 * Per-platform profile analytics. By default each platform's API returns
 * whatever window it considers "headline" — TikTok = 28d, IG = 7/28d,
 * YouTube = lifetime, Pinterest = 30d, X = varies. Pass `startDate`/`endDate`
 * (YYYY-MM-DD) to ask Upload-Post to constrain to a window where the
 * underlying platform API supports it; platforms that don't support
 * windowing (e.g. YouTube lifetime) still return their default scope, which
 * is why the per-platform cards may not sum to the page-wide impressions
 * total.
 */
export async function getAnalytics(
  platforms: string[],
  opts: { startDate?: string; endDate?: string } = {},
) {
  const params = new URLSearchParams({
    platforms: platforms.join(","),
  });
  if (opts.startDate) params.set("start_date", opts.startDate);
  if (opts.endDate) params.set("end_date", opts.endDate);

  return fetchJson<AnalyticsResponse>(`/analytics/${encodeURIComponent(PROFILE_USERNAME)}?${params.toString()}`);
}

/**
 * Upload-Post's `/total-impressions` endpoint returns a windowed impression
 * count (default ~30 days when no params are passed). Accept optional
 * start/end dates so the homepage's period selector can drive the window —
 * Upload-Post echoes whichever range it actually used back in the response,
 * which we display under the card.
 *
 * Date format must be YYYY-MM-DD (Upload-Post ignores time components and
 * rejects ISO timestamps).
 */
export async function getTotalImpressions(opts: { startDate?: string; endDate?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.startDate) params.set("start_date", opts.startDate);
  if (opts.endDate) params.set("end_date", opts.endDate);
  const qs = params.toString();
  const path = `/uploadposts/total-impressions/${encodeURIComponent(PROFILE_USERNAME)}${qs ? `?${qs}` : ""}`;
  return fetchJson<TotalImpressionsResponse>(path);
}

export async function getPostAnalytics(requestId: string) {
  return fetchJson<PostAnalyticsResponse>(`/uploadposts/post-analytics/${encodeURIComponent(requestId)}`);
}

export async function getReadOnlyCalendarUrl() {
  const body = {
    username: PROFILE_USERNAME,
    readonly_calendar: true,
    connect_title: CALENDAR_TITLE,
    ...(CALENDAR_LOGO ? { logo_image: CALENDAR_LOGO } : {}),
  };

  return fetchJson<CalendarJwtResponse>("/uploadposts/users/generate-jwt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function normalizeHistory(response: HistoryResponse): HistoryItem[] {
  return (response.history || []).map((item) => ({
    ...item,
    title: item.post_title,
    caption: item.post_caption,
    created_at: item.upload_timestamp,
    status: item.success === true ? "published" : item.success === false ? "failed" : item.status,
  }));
}

export function normalizeAnalytics(response: AnalyticsResponse): AnalyticsMetric[] {
  return Object.entries(response).map(([platform, metrics]) => ({
    platform,
    ...metrics,
  }));
}

export function normalizeScheduledPosts(response: ScheduleResponse): ScheduledPost[] {
  return (response.scheduled_posts || [])
    .map((p) => {
      // Upload-Post is inconsistent about which platforms it lists in
      // `platforms` vs which it keys under `platform_content` (the per-
      // platform title/caption map). Pinterest in particular often only
      // shows up in `platform_content`, which means the calendar legend
      // (and the platform dot row) never renders it. Union both sources so
      // every platform that has *any* signal on the post is surfaced.
      const fromArray = p.platforms || [];
      const fromContent = p.platform_content ? Object.keys(p.platform_content) : [];
      if (!fromContent.length) return p;
      const seen = new Set(fromArray);
      const merged = [...fromArray];
      for (const key of fromContent) {
        if (!seen.has(key)) {
          merged.push(key);
          seen.add(key);
        }
      }
      return merged.length === fromArray.length ? p : { ...p, platforms: merged };
    })
    .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime());
}

/**
 * Every metric-summary field checks a *list* of possible field names because
 * Upload-Post's response shape drifts per platform. Pinterest returns
 * `follower_count` where TikTok returns `followers`; Meta uses `impressions`
 * where YouTube uses `view_count`, etc. The picker takes the first
 * positive number it finds so a present-but-zero synonym doesn't shadow a
 * populated one further down the fallback list.
 */
function pickNumber(source: Record<string, unknown>, keys: string[]): number {
  let best = 0;
  for (const k of keys) {
    const raw = source[k];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

export function summarizeAnalytics(metric?: AnalyticsMetric) {
  if (!metric) {
    return {
      followers: 0,
      impressions: 0,
      reach: 0,
      profileViews: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
    };
  }

  const m = metric as Record<string, unknown>;
  return {
    followers: pickNumber(m, [
      "followers",
      "follower_count",
      "followers_count",
      "subscribers",
      "subscriber_count",
      "total_followers",
    ]),
    impressions: pickNumber(m, [
      "impressions",
      "impression_count",
      "views",
      "view_count",
      "total_views",
      "pin_impressions",
      "plays",
    ]),
    reach: pickNumber(m, ["reach", "unique_impressions", "unique_reach"]),
    profileViews: pickNumber(m, [
      "profileViews",
      "profile_views",
      "profile_view_count",
      "page_views",
    ]),
    likes: pickNumber(m, ["likes", "like_count", "favorites", "reactions", "reaction_count"]),
    comments: pickNumber(m, ["comments", "comment_count", "replies", "reply_count"]),
    shares: pickNumber(m, ["shares", "share_count", "reposts", "repost_count", "retweets"]),
    saves: pickNumber(m, ["saves", "save_count", "bookmarks", "bookmark_count"]),
  };
}
