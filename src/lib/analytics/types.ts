// Provider-agnostic shapes for mobile app analytics.
// App Store Connect is the first implementation; Google Play will slot in
// later by implementing the same AnalyticsProvider contract.

import type { Period } from "@/lib/period";

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

// ---- Financial (Sales & Trends) ----------------------------------------
export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface FinanceSummary {
  proceeds?: MoneyAmount;              // developer proceeds for the period, dominant currency
  refunds?: MoneyAmount;                // negative value representing refunded proceeds
  paidDownloads?: number;
  freeDownloads?: number;
  updates?: number;
  redownloads?: number;
  /** Per-currency breakdown when storefronts span multiple currencies. */
  proceedsByCurrency?: MoneyAmount[];
  /** Total proceeds in the period, normalized to dominantCurrency if conversion was available. */
  note?: string;
}

// ---- Territories & devices ---------------------------------------------
export interface TerritoryStat {
  territory: string;          // ISO 3166 alpha-3 from ASC
  units: number;
  proceeds?: MoneyAmount;
}

export interface DeviceStat {
  device: string;             // e.g. "iPhone", "iPad"
  units: number;
  share?: number;             // 0..1
}

export interface SourceStat {
  source: string;             // "App Store Search", "App Store Browse", "Web Referrer", "App Referrer", "Institutional Purchase", "Unavailable"
  units: number;
  share?: number;
}

// ---- Funnel (Analytics Reports API) ------------------------------------
export interface FunnelSummary {
  impressions?: number;
  productPageViews?: number;
  firstTimeDownloads?: number;
  conversionRate?: number;    // 0..1, downloads / impressions
  impressionsSeries?: TimeSeriesPoint[];
  pageViewsSeries?: TimeSeriesPoint[];
}

// ---- Subscriptions -----------------------------------------------------
export interface SubscriptionGroupStat {
  groupName: string;
  activeSubscribers?: number;
  newSubscriptions?: number;
  renewals?: number;
  cancellations?: number;
  billingRetry?: number;
  grace?: number;
  proceeds?: MoneyAmount;
  churnRate?: number;         // cancellations / activeSubscribers
}

export interface SubscriptionsSummary {
  groups: SubscriptionGroupStat[];
  totalActive?: number;
  totalProceeds?: MoneyAmount;
}

export interface IapProductStat {
  sku: string;
  name?: string;
  units: number;
  proceeds?: MoneyAmount;
}

export interface IapSummary {
  products: IapProductStat[];
  totalUnits?: number;
  totalProceeds?: MoneyAmount;
}

// ---- Search & app versions --------------------------------------------
export interface SearchTermStat {
  term: string;
  impressions?: number;
  pageViews?: number;
  downloads?: number;
  share?: number;             // relative to top terms
}

export interface AppVersionStat {
  version: string;
  adoption?: number;          // share of active installs using this version, 0..1
  firstAppeared?: string;     // ISO date
}

// ---- Active devices / retention / crashes ------------------------------
export interface ActiveDevicesSummary {
  daily?: number;
  weekly?: number;
  monthly?: number;
  sessionsPerDevice?: number;
}

export interface RetentionCohort {
  cohortDate: string;
  day1?: number;              // 0..1
  day7?: number;
  day28?: number;
}

// ---- TestFlight --------------------------------------------------------
export interface TestFlightBuild {
  version: string;
  buildNumber: string;
  processingState?: string;   // PROCESSING, VALID, INVALID, FAILED
  uploadedDate?: string;
  expired?: boolean;
}

export interface TestFlightSummary {
  builds: TestFlightBuild[];
  internalTesters?: number;
  externalTesters?: number;
  betaFeedbackCrashes?: number;
}

// ---- Top-level snapshot ------------------------------------------------
export interface AppSnapshot {
  app: AppMeta;
  ratings?: RatingsSummary;
  reviews: Review[];
  installs?: TimeSeriesStats;
  /** Trailing window the snapshot covers — drives KPI sub-text labels. */
  period?: Period;
  /** Daily uninstall counts ("user loss" in Play Console). Android-only. */
  uninstalls?: TimeSeriesStats;
  /** Most recent "Active Device Installs" — the current install base size. */
  activeInstalls?: number;
  crashes?: CrashStats;
  performance?: PerformanceMetric[];
  finance?: FinanceSummary;
  territories?: TerritoryStat[];
  devices?: DeviceStat[];
  sources?: SourceStat[];
  funnel?: FunnelSummary;
  subscriptions?: SubscriptionsSummary;
  iap?: IapSummary;
  searchTerms?: SearchTermStat[];
  appVersions?: AppVersionStat[];
  activeDevices?: ActiveDevicesSummary;
  retention?: RetentionCohort[];
  testflight?: TestFlightSummary;
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
  fetchSnapshot(appId: string, opts?: { period?: Period }): Promise<AppSnapshot>;
}
