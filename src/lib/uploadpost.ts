const API_BASE = process.env.UPLOAD_POST_API_BASE || "https://api.upload-post.com/api";
const API_KEY = process.env.UPLOAD_POST_API_KEY;
const PROFILE_USERNAME = process.env.UPLOAD_POST_PROFILE_USERNAME || "catharsis";

function getHeaders() {
  if (!API_KEY) {
    throw new Error("Missing UPLOAD_POST_API_KEY environment variable");
  }

  return {
    Authorization: `Apikey ${API_KEY}`,
    Accept: "application/json",
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: getHeaders(),
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

export async function getHistory() {
  return fetchJson<HistoryResponse>("/uploadposts/history");
}

export async function getAnalytics(platforms: string[]) {
  const params = new URLSearchParams({
    platforms: platforms.join(","),
  });

  return fetchJson<AnalyticsResponse>(`/analytics/${encodeURIComponent(PROFILE_USERNAME)}?${params.toString()}`);
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

export function groupUpcomingPosts(items: HistoryItem[]) {
  const now = Date.now();

  return items
    .filter((item) => item.scheduled_date && new Date(item.scheduled_date).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_date || 0).getTime() - new Date(b.scheduled_date || 0).getTime());
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
