import { gunzipSync } from "node:zlib";
import { ascFetchRaw, AppStoreApiError } from "./client";
import type { TimeSeriesStats } from "../types";

// App Store Connect Sales & Trends API returns a gzipped tab-separated report.
// Daily reports are only available after Apple has processed the day (usually 24h
// after the day ends in Apple's Pacific reporting window). We fetch one report
// per day in parallel and combine into a time series.

interface DailySalesRow {
  "Begin Date"?: string;
  "End Date"?: string;
  "Apple Identifier"?: string;
  SKU?: string;
  "Product Type Identifier"?: string;
  Units?: string;
  "Developer Proceeds"?: string;
  "Customer Currency"?: string;
  "Currency of Proceeds"?: string;
  [k: string]: string | undefined;
}

function parseTsv(text: string): DailySalesRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: DailySalesRow = {};
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

async function fetchDailyReport(vendorNumber: string, date: Date): Promise<DailySalesRow[] | null> {
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

function isDownloadProductType(code: string | undefined): boolean {
  if (!code) return false;
  // Types starting with "1" are first-time app downloads (1, 1F, 1T, 1E, 1EP).
  // Update ("7"), in-app purchase ("IA*"), and subscription rows are excluded.
  return /^1[A-Z]*$/i.test(code);
}

export interface SalesSnapshot {
  installs: TimeSeriesStats;
  proceeds?: { amount: number; currency: string };
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

  // If no reports came back at all, report a warning rather than an empty chart.
  const anyRows = results.some((r) => r.rows && r.rows.length);
  if (!anyRows) {
    return {
      snapshot: null,
      warning:
        "No daily sales reports yet. Reports typically arrive ~24h after the day closes in Apple's reporting window.",
    };
  }

  const points = results
    .slice()
    .reverse() // oldest → newest
    .map(({ date, rows }) => {
      const relevant = (rows || []).filter(
        (r) =>
          r["Apple Identifier"] === appId &&
          isDownloadProductType(r["Product Type Identifier"]),
      );
      const units = relevant.reduce((sum, r) => sum + Number(r.Units || 0), 0);
      return { date: apiDateString(date), value: units };
    });

  // Proceeds: sum "Developer Proceeds" * "Units" across download rows in one currency.
  // Apple reports proceeds in the local currency of the storefront; we pick the most
  // common currency to avoid mixing, and sum only rows that use it.
  const currencyTotals: Record<string, number> = {};
  for (const { rows } of results) {
    for (const r of rows || []) {
      if (r["Apple Identifier"] !== appId) continue;
      if (!isDownloadProductType(r["Product Type Identifier"])) continue;
      const currency = r["Currency of Proceeds"] || "USD";
      const per = Number(r["Developer Proceeds"] || 0);
      const units = Number(r.Units || 0);
      currencyTotals[currency] = (currencyTotals[currency] || 0) + per * units;
    }
  }
  let proceeds: { amount: number; currency: string } | undefined;
  const dominantCurrency = Object.entries(currencyTotals).sort((a, b) => b[1] - a[1])[0];
  if (dominantCurrency) {
    proceeds = { currency: dominantCurrency[0], amount: dominantCurrency[1] };
  }

  const total = points.reduce((s, p) => s + p.value, 0);

  return {
    snapshot: {
      installs: { unit: "installs", total, points },
      proceeds,
    },
  };
}
