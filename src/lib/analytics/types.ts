// Provider-agnostic shapes for mobile app analytics.
// App Store Connect is the first implementation; Google Play will slot in
// later by implementing the same AnalyticsProvider contract.

export type Platform = "ios" | "android";

export interface AppMeta {
  id: string;                 // platform-specific id (ASC app id / Play package)
  platform: Platform;
  name: string;
  bundleId?: string;          // iOS bundle id
  packageName?: string;       // Android package
  iconUrl?: string;
  primaryLocale?: string;
  subtitle?: string;
}

export interface RatingsSummary {
  average: number;            // 1..5
  count: number;
  distribution?: Record<"1" | "2" | "3" | "4" | "5", number>;
  sampledFromReviews?: boolean; // true when avg is computed from review sample
}

export interface Review {
  id: string;
  rating: number;
  title?: string;
  body: string;
  author?: string;
  createdAt: string;
  territory?: string;
  responseBody?: string;
  responseDate?: string;
}

export interface TimeSeriesPoint {
  date: string;               // ISO date (YYYY-MM-DD, local to Europe/Berlin display)
  value: number;
}

export interface TimeSeriesStats {
  unit: string;               // e.g. "installs", "sessions"
  total: number;
  points: TimeSeriesPoint[];
}

export interface PerformanceMetric {
  identifier: string;         // e.g. "LAUNCH_TIME", "HANG_RATE", "MEMORY", "DISK", "BATTERY"
  displayName: string;
  value?: number | string;
  unit?: string;
  goal?: number | string;
  note?: string;
}

export interface CrashStats {
  crashCount?: number;
  crashFreeUsers?: number;    // percent 0..1
  hangRate?: number;
  // Whenever ASC's public API can't reliably give us this, we expose what we can.
  note?: string;
}

export interface AppSnapshot {
  app: AppMeta;
  ratings?: RatingsSummary;
  reviews: Review[];
  installs?: TimeSeriesStats;
  crashes?: CrashStats;
  performance?: PerformanceMetric[];
  warnings: string[];         // non-fatal issues surfaced to UI (missing vendor # etc.)
  generatedAt: string;        // ISO timestamp of the snapshot
}

export interface AnalyticsProvider {
  platform: Platform;
  /** e.g. "App Store Connect" / "Google Play Console". Used in UI labels. */
  displayName: string;
  /** Fast env-var check so the UI can show a setup state instead of crashing. */
  isConfigured(): boolean;
  listApps(): Promise<AppMeta[]>;
  fetchSnapshot(appId: string): Promise<AppSnapshot>;
}
