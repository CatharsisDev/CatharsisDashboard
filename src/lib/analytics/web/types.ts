// Provider-agnostic shapes for website analytics. Today this is GA4 only.
// Mirrors the AppSnapshot pattern from analytics/types.ts so the UI can lean
// on the same conventions (warnings array, generatedAt, optional fields that
// degrade gracefully when a panel can't be filled).

export interface WebKpis {
  /** Active users in the trailing 30 days. */
  activeUsers?: number;
  /** Sessions in the trailing 30 days. */
  sessions?: number;
  /** Page views (screenPageViews) in the trailing 30 days. */
  pageViews?: number;
  /** GA4 "average engagement time per session" in seconds. */
  avgEngagementTimeSec?: number;
  /** Sum of all events flagged as 'key events' (formerly 'conversions'). */
  keyEvents?: number;
}

export interface WebDailyPoint {
  date: string;          // ISO YYYY-MM-DD (Berlin TZ display)
  sessions: number;
  activeUsers: number;
}

export interface WebTopPage {
  path: string;          // pagePath from GA4 (e.g. /pricing)
  title?: string;        // pageTitle when available
  views: number;
  users: number;
  avgEngagementTimeSec?: number;
}

export interface WebTrafficSource {
  source: string;        // sessionSource (e.g. google, instagram.com, (direct))
  medium: string;        // sessionMedium (e.g. organic, social, none)
  sessions: number;
  users: number;
}

export interface WebGeoStat {
  country: string;       // ISO country name from GA4
  sessions: number;
  users: number;
}

export interface WebDeviceStat {
  category: string;      // desktop / mobile / tablet
  sessions: number;
  users: number;
  share?: number;        // 0..1
}

export interface WebKeyEventStat {
  name: string;          // event name (e.g. sign_up)
  count: number;
  conversionRate?: number; // events / sessions, 0..1
}

export interface WebSnapshot {
  /** Property display name + ID, surfaced in the page header. */
  propertyId: string;
  hostname: string;      // catharsis.cards (config'd, displayed as label)
  kpis: WebKpis;
  daily?: WebDailyPoint[];
  topPages?: WebTopPage[];
  sources?: WebTrafficSource[];
  geography?: WebGeoStat[];
  devices?: WebDeviceStat[];
  keyEvents?: WebKeyEventStat[];
  warnings: string[];
  generatedAt: string;   // ISO timestamp
}
