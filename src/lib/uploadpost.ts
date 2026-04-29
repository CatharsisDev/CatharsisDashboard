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

export async function getAnalytics(platforms: string[]) {
  const params = new URLSearchParams({
    platforms: platforms.join(","),
  });

  return fetchJson<AnalyticsResponse>(`/analytics/${encodeURIComponent(PROFILE_USERNAME)}?${params.toString()}`);
}

export async function getTotalImpressions() {
  return fetchJson<TotalImpressionsResponse>(`/uploadposts/total-impressions/${encodeURIComponent(PROFILE_USERNAME)}`);
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

  return {
    followers: Number(metric.followers || 0),
    impressions: Number(metric.impressions || metric.views || 0),
    reach: Number(metric.reach || 0),
    profileViews: Number(metric.profileViews || 0),
    likes: Number(metric.likes || 0),
    comments: Number(metric.comments || 0),
    shares: Number(metric.shares || 0),
    saves: Number(metric.saves || 0),
  };
}
