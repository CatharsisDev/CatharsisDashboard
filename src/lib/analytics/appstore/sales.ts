import { gunzipSync } from "node:zlib";
import { ascFetchRaw, AppStoreApiError } from "./client";
import type {
  DeviceStat,
  FinanceSummary,
  IapProductStat,
  IapSummary,
  MoneyAmount,
  TerritoryStat,
  TimeSeriesStats,
} from "../types";

// App Store Connect Sales & Trends API returns a gzipped tab-separated report.
// Daily reports are only available after Apple has processed the day (usually 24h
// after the day ends in Apple's Pacific reporting window). We fetch one report
// per day in parallel and combine into a rich summary with multiple views
// (installs, proceeds, paid/free split, territories, devices, IAP breakdown).

interface SalesRow {
  "Provider"?: string;
  "Provider Country"?: string;
  "SKU"?: string;
  "Developer"?: string;
  "Title"?: string;
  "Version"?: string;
  "Product Type Identifier"?: string;
  "Units"?: string;
  "Developer Proceeds"?: string;
  "Begin Date"?: string;
  "End Date"?: string;
  "Customer Currency"?: string;
  "Country Code"?: string;
  "Currency of Proceeds"?: string;
  "Apple Identifier"?: string;
  "Customer Price"?: string;
  "Promo Code"?: string;
  "Parent Identifier"?: string;
  "Subscription"?: string;
  "Period"?: string;
  "Category"?: string;
  "CMB"?: string;
  "Device"?: string;
  "Supported Platforms"?: string;
  "Proceeds Reason"?: string;
  "Preserved Pricing"?: string;
  "Client"?: string;
  "Order Type"?: string;
  [k: string]: string | undefined;
}

function parseTsv(text: string): SalesRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: SalesRow = {};
    headers.forEach((h, i) => {
      row[h] = cols[i];
    });
    return row;
  });
}

function apiDateString(d: Date): string {
  // Use UTC date string (YYYY-MM-DD) per ASC API.
  return d.toISOString().slice(0, 10);
}

async function fetchDailyReport(vendorNumber: string, date: Date): Promise<SalesRow[] | null> {
  try {
    const res = await ascFetchRaw("/v1/salesReports", {
      acceptGzip: true,
      query: {
        "filter[frequency]": "DAILY",
        "filter[reportType]": "SALES",
        "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]": vendorNumber,
        "filter[reportDate]": apiDateString(date),
        "filter[version]": "1_1",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = gunzipSync(buf).toString("utf8");
    return parseTsv(text);
  } catch (err) {
    if (err instanceof AppStoreApiError && err.status === 404) return null;
    throw err;
  }
}

// Product type classifications based on Apple's Sales & Trends documentation.
function isFirstTimeDownload(code: string | undefined): boolean {
  if (!code) return false;
  // "1" with no "R" prefix → fresh download; excludes 1R, 1RP (redownloads).
  return /^1([A-QS-Z][A-Z]*)?$/i.test(code);
}

function isFreeDownload(code: string | undefined): boolean {
  if (!code) return false;
  return /^1F/i.test(code);
}

function isUpdate(code: string | undefined): boolean {
  return !!code && /^7/i.test(code);
}

function isRedownload(code: string | undefined): boolean {
  return !!code && /^1R/i.test(code);
}

function isIap(code: string | undefined): boolean {
  return !!code && /^IA/i.test(code);
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Territory codes from ASC are ISO 3166-1 alpha-2. Surface them as the short
// code; UI layer can map to country names / flags when needed.
interface AggregateAccumulator {
  rowsTotal: number;
  firstTime: number;
  firstTimeFree: number;
  firstTimePaid: number;
  updates: number;
  redownloads: number;
  iapUnits: number;
  proceedsByCurrency: Record<string, number>;
  refundsByCurrency: Record<string, number>;
  iapProceedsByCurrency: Record<string, number>;
  territoryUnits: Record<string, number>;
  territoryProceeds: Record<string, Record<string, number>>;
  deviceUnits: Record<string, number>;
  iapProducts: Record<string, { name?: string; units: number; proceeds: Record<string, number> }>;
}

function emptyAccumulator(): AggregateAccumulator {
  return {
    rowsTotal: 0,
    firstTime: 0,
    firstTimeFree: 0,
    firstTimePaid: 0,
    updates: 0,
    redownloads: 0,
    iapUnits: 0,
    proceedsByCurrency: {},
    refundsByCurrency: {},
    iapProceedsByCurrency: {},
    territoryUnits: {},
    territoryProceeds: {},
    deviceUnits: {},
    iapProducts: {},
  };
}

function ingestRow(acc: AggregateAccumulator, appId: string, r: SalesRow): void {
  if (r["Apple Identifier"] !== appId) return;
  acc.rowsTotal += 1;
  const code = r["Product Type Identifier"];
  const units = num(r.Units);
  const perUnitProceeds = num(r["Developer Proceeds"]);
  const currency = r["Currency of Proceeds"] || "USD";
  const territory = r["Country Code"] || r["Provider Country"] || "ZZ";
  const device = (r["Device"] || "").trim();

  // Refunds appear as negative Units in Apple's reports. Separate them.
  const isRefund = units < 0;

  if (isFirstTimeDownload(code)) {
    if (!isRefund) acc.firstTime += units;
    if (isFreeDownload(code)) acc.firstTimeFree += units;
    else acc.firstTimePaid += units;
    acc.territoryUnits[territory] = (acc.territoryUnits[territory] || 0) + units;
    if (device) acc.deviceUnits[device] = (acc.deviceUnits[device] || 0) + units;
  } else if (isUpdate(code)) {
    acc.updates += units;
  } else if (isRedownload(code)) {
    acc.redownloads += units;
  } else if (isIap(code)) {
    acc.iapUnits += units;
    const sku = r.SKU || code || "UNKNOWN";
    const name = r.Title;
    if (!acc.iapProducts[sku]) acc.iapProducts[sku] = { name, units: 0, proceeds: {} };
    acc.iapProducts[sku].units += units;
    const revenue = perUnitProceeds * units;
    acc.iapProducts[sku].proceeds[currency] =
      (acc.iapProducts[sku].proceeds[currency] || 0) + revenue;
    acc.iapProceedsByCurrency[currency] =
      (acc.iapProceedsByCurrency[currency] || 0) + revenue;
  }

  // Proceeds: sum per currency for every revenue-producing row.
  const revenue = perUnitProceeds * units;
  if (Number.isFinite(revenue) && revenue !== 0) {
    if (isRefund) {
      acc.refundsByCurrency[currency] =
        (acc.refundsByCurrency[currency] || 0) + revenue;
    } else {
      acc.proceedsByCurrency[currency] =
        (acc.proceedsByCurrency[currency] || 0) + revenue;
      if (!acc.territoryProceeds[territory]) acc.territoryProceeds[territory] = {};
      acc.territoryProceeds[territory][currency] =
        (acc.territoryProceeds[territory][currency] || 0) + revenue;
    }
  }
}

function dominantCurrency(totals: Record<string, number>): string | undefined {
  const entries = Object.entries(totals).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries[0]?.[0];
}

function toMoneyList(totals: Record<string, number>): MoneyAmount[] {
  return Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([currency, amount]) => ({
      currency,
      amount: Number(amount.toFixed(2)),
    }));
}

function aggregateToFinance(acc: AggregateAccumulator): FinanceSummary | undefined {
  const hasAny =
    acc.firstTime ||
    acc.updates ||
    acc.redownloads ||
    Object.keys(acc.proceedsByCurrency).length ||
    Object.keys(acc.refundsByCurrency).length;
  if (!hasAny) return undefined;

  const proceedsList = toMoneyList(acc.proceedsByCurrency);
  const refundsList = toMoneyList(acc.refundsByCurrency);
  const dominant = dominantCurrency(acc.proceedsByCurrency);

  const proceeds = dominant
    ? { currency: dominant, amount: Number((acc.proceedsByCurrency[dominant] || 0).toFixed(2)) }
    : undefined;
  const refundsDominant = dominantCurrency(acc.refundsByCurrency);
  const refunds = refundsDominant
    ? {
        currency: refundsDominant,
        amount: Number((acc.refundsByCurrency[refundsDominant] || 0).toFixed(2)),
      }
    : undefined;

  return {
    proceeds,
    refunds,
    paidDownloads: acc.firstTimePaid,
    freeDownloads: acc.firstTimeFree,
    updates: acc.updates,
    redownloads: acc.redownloads,
    proceedsByCurrency: proceedsList.length > 1 ? proceedsList : undefined,
    note:
      proceedsList.length > 1
        ? `Multiple storefront currencies — showing dominant currency in headline, ${refundsList.length ? "refunds separated" : "no refunds"}.`
        : undefined,
  };
}

function aggregateToTerritories(acc: AggregateAccumulator): TerritoryStat[] {
  const dominant = dominantCurrency(acc.proceedsByCurrency);
  return Object.entries(acc.territoryUnits)
    .sort((a, b) => b[1] - a[1])
    .map(([territory, units]) => {
      const proceedsByCurrency = acc.territoryProceeds[territory] || {};
      const amount = dominant ? proceedsByCurrency[dominant] : undefined;
      return {
        territory,
        units,
        proceeds:
          dominant && typeof amount === "number"
            ? { currency: dominant, amount: Number(amount.toFixed(2)) }
            : undefined,
      } as TerritoryStat;
    });
}

function aggregateToDevices(acc: AggregateAccumulator): DeviceStat[] {
  const entries = Object.entries(acc.deviceUnits).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return entries.map(([device, units]) => ({
    device,
    units,
    share: units / total,
  }));
}

function aggregateToIap(acc: AggregateAccumulator): IapSummary | undefined {
  const products = Object.entries(acc.iapProducts)
    .sort((a, b) => b[1].units - a[1].units)
    .map(([sku, data]) => {
      const dom = dominantCurrency(data.proceeds);
      return {
        sku,
        name: data.name,
        units: data.units,
        proceeds:
          dom !== undefined
            ? { currency: dom, amount: Number((data.proceeds[dom] || 0).toFixed(2)) }
            : undefined,
      } as IapProductStat;
    });
  if (!products.length) return undefined;
  const totalUnits = products.reduce((s, p) => s + p.units, 0);
  const dom = dominantCurrency(acc.iapProceedsByCurrency);
  const totalProceeds = dom
    ? {
        currency: dom,
        amount: Number((acc.iapProceedsByCurrency[dom] || 0).toFixed(2)),
      }
    : undefined;
  return { products, totalUnits, totalProceeds };
}

export interface SalesSnapshot {
  installs: TimeSeriesStats;
  finance?: FinanceSummary;
  territories?: TerritoryStat[];
  devices?: DeviceStat[];
  iap?: IapSummary;
}

export async function getDailySales(
  appId: string,
  vendorNumber: string,
  days = 7,
): Promise<{ snapshot: SalesSnapshot | null; warning?: string }> {
  const now = new Date();
  // Yesterday (UTC) is the most recent day Apple has reports for.
  const targets: Date[] = [];
  for (let offset = 1; offset <= days; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    targets.push(d);
  }

  const results = await Promise.all(
    targets.map(async (d) => ({ date: d, rows: await fetchDailyReport(vendorNumber, d) })),
  );

  const anyRows = results.some((r) => r.rows && r.rows.length);
  if (!anyRows) {
    return {
      snapshot: null,
      warning:
        "No daily sales reports yet. Reports typically arrive ~24h after the day closes in Apple's reporting window.",
    };
  }

  const acc = emptyAccumulator();
  for (const { rows } of results) {
    for (const r of rows || []) ingestRow(acc, appId, r);
  }

  const points = results
    .slice()
    .reverse() // oldest → newest
    .map(({ date, rows }) => {
      const relevant = (rows || []).filter(
        (r) =>
          r["Apple Identifier"] === appId &&
          isFirstTimeDownload(r["Product Type Identifier"]),
      );
      const units = relevant.reduce((sum, r) => sum + num(r.Units), 0);
      return { date: apiDateString(date), value: units };
    });

  const total = points.reduce((s, p) => s + p.value, 0);

  return {
    snapshot: {
      installs: { unit: "installs", total, points },
      finance: aggregateToFinance(acc),
      territories: aggregateToTerritories(acc),
      devices: aggregateToDevices(acc),
      iap: aggregateToIap(acc),
    },
  };
}
