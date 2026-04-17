const API_BASE = process.env.UPLOAD_POST_API_BASE || "https://api.upload-post.com/api";
const API_KEY = process.env.UPLOAD_POST_API_KEY;

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
  metric_type?: string;
  value?: number;
  date?: string;
  platform?: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  profile_views?: number;
};

export type AnalyticsResponse = {
  username?: string;
  profile_username?: string;
  profile?: string;
  analytics?: AnalyticsMetric[];
  metrics?: AnalyticsMetric[];
  data?: AnalyticsMetric[];
  [key: string]: unknown;
};

export type HistoryItem = {
  id?: string | number;
  request_id?: string;
  job_id?: string;
  title?: string;
  caption?: string;
  description?: string;
  status?: string;
  platform?: string;
  platforms?: string[];
  scheduled_date?: string;
  created_at?: string;
  media_type?: string;
  post_url?: string;
  thumbnail_url?: string;
  [key: string]: unknown;
};

export type HistoryResponse = {
  uploads?: HistoryItem[];
  data?: HistoryItem[];
  history?: HistoryItem[];
  items?: HistoryItem[];
  [key: string]: unknown;
};

export async function getHistory() {
  return fetchJson<HistoryResponse>("/uploadposts/history");
}

export async function getAnalytics(profileUsername: string) {
  return fetchJson<AnalyticsResponse>(`/analytics/${encodeURIComponent(profileUsername)}`);
}

export function normalizeHistory(response: HistoryResponse): HistoryItem[] {
  return response.uploads || response.data || response.history || response.items || [];
}

export function normalizeAnalytics(response: AnalyticsResponse): AnalyticsMetric[] {
  return response.analytics || response.metrics || response.data || [];
}

export function groupUpcomingPosts(items: HistoryItem[]) {
  const now = Date.now();

  return items
    .filter((item) => item.scheduled_date && new Date(item.scheduled_date).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_date || 0).getTime() - new Date(b.scheduled_date || 0).getTime());
}

export function summarizeAnalytics(metrics: AnalyticsMetric[]) {
  const summary = {
    followers: 0,
    impressions: 0,
    reach: 0,
    profileViews: 0,
  };

  for (const metric of metrics) {
    summary.followers += Number(metric.followers || 0);
    summary.impressions += Number(metric.impressions || 0);
    summary.reach += Number(metric.reach || 0);
    summary.profileViews += Number(metric.profile_views || 0);
  }

  return summary;
}
