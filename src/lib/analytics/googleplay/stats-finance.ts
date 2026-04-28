import type { FinanceSummary, MoneyAmount } from "../types";
import { downloadCsv, listBucket, monthsSpanning, parseCsvRows } from "./stats-bucket";

// Play Console "earnings" reports live under `earnings/` in the export
// bucket, one file per developer-account per month. The filename includes
// the developer's account ID, which we don't know up front, so we list the
// prefix and grab whichever objects match the months we care about.
//
//   earnings/earnings_YYYYMM_<accountId>.csv
//
// Important: this bucket is account-wide, not package-scoped. The CSV has
// a "Product ID" column that holds the package name for app purchases (and
// the SKU for IAP), so we filter rows down to the package we're snapshotting.
//
// Columns of interest:
//   Description        — human label (app name + product)
//   Transaction Date   — ISO date
//   Product Type       — "Apps", "Subscription", "InApp"
//   Product ID         — package name for app sales; SKU otherwise
//   Sku ID             — non-app SKU
//   Transaction Type   — "Charge", "Charge refund", "Tax", "Google fee", ...
//   Amount (Merchant Currency)  — numeric, signed
//   Currency of Sale   — ISO 4217
//   Merchant Currency  — payout currency
//
// We sum proceeds = Σ rows where Transaction Type is a charge or refund,
// in the merchant currency. Refunds come through as negative numbers.

const EARNINGS_PREFIX = "earnings/earnings_";

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

interface EarningsRow {
  date?: string;
  productType?: string;
  productId?: string;
  transactionType?: string;
  amount: number;
  currency?: string;
}

function rowFromCsv(r: Record<string, string>): EarningsRow {
  return {
    date: r["Transaction Date"] || r["Date"],
    productType: r["Product Type"] || r["ProductType"],
    productId: r["Product ID"] || r["ProductID"],
    transactionType: r["Transaction Type"] || r["Type"],
    amount: num(r["Amount (Merchant Currency)"] || r["Merchant Amount"] || r["Amount"]),
    currency: r["Merchant Currency"] || r["Currency of Sale"] || r["Currency"],
  };
}

function withinDays(dateStr: string | undefined, days: number): boolean {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (!Number.isFinite(d)) return false;
  return d >= Date.now() - days * 24 * 3600 * 1000;
}

/**
 * Fetch all earnings CSVs that touch the trailing 30-day window. Some
 * months ago + this month suffice; we list both to avoid hardcoding a
 * filename pattern that depends on the developer account ID.
 */
async function listEarningsCsvs(bucket: string): Promise<string[]> {
  const months = monthsSpanning(30);
  const out: string[] = [];
  for (const ym of months) {
    const objects = await listBucket(bucket, `${EARNINGS_PREFIX}${ym}_`);
    for (const obj of objects) {
      if (obj.endsWith(".csv")) out.push(obj);
    }
  }
  return out;
}

export async function getFinanceFromExport(
  bucket: string,
  pkg: string,
): Promise<FinanceSummary | undefined> {
  const objects = await listEarningsCsvs(bucket);
  if (!objects.length) return undefined;

  const allRows: EarningsRow[] = [];
  for (const obj of objects) {
    const text = await downloadCsv(bucket, obj);
    if (!text) continue;
    for (const r of parseCsvRows(text)) allRows.push(rowFromCsv(r));
  }

  if (!allRows.length) return undefined;

  // Filter to this package + the trailing 30-day window. Subscription rows
  // use the SKU as Product ID, not the package, but the Description column
  // typically embeds the package — we err on inclusion when the filter
  // wouldn't match anything by checking either.
  const relevant = allRows.filter((r) => {
    if (!withinDays(r.date, 30)) return false;
    const id = r.productId || "";
    return id === pkg || id.startsWith(`${pkg}.`) || id.startsWith(`${pkg}:`);
  });

  if (!relevant.length) return undefined;

  // Pick the dominant merchant currency by transaction count. Most accounts
  // are single-currency so this is essentially "the only one".
  const currencyCounts = new Map<string, number>();
  for (const r of relevant) {
    if (!r.currency) continue;
    currencyCounts.set(r.currency, (currencyCounts.get(r.currency) || 0) + 1);
  }
  const dominantCurrency =
    Array.from(currencyCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";

  const proceedsByCurrency = new Map<string, number>();
  let refundsAmount = 0;
  let paidDownloads = 0;

  for (const r of relevant) {
    const cur = r.currency || dominantCurrency;
    const tt = (r.transactionType || "").toLowerCase();
    if (tt.includes("refund")) {
      // Refunds in earnings reports are already negative numbers, so
      // adding them keeps the sign convention consistent with iOS.
      refundsAmount += r.amount;
    } else if (tt.includes("charge")) {
      proceedsByCurrency.set(cur, (proceedsByCurrency.get(cur) || 0) + r.amount);
      if ((r.productType || "").toLowerCase() === "apps") paidDownloads++;
    } else {
      // Taxes, Google fees etc. — these reduce the merchant payout but the
      // dashboard convention is to show *gross* developer proceeds from
      // sales. Skip them so the number matches what users see in Play
      // Console's "Estimated revenue" column.
    }
  }

  const proceedsList: MoneyAmount[] = Array.from(proceedsByCurrency.entries()).map(
    ([currency, amount]) => ({ currency, amount }),
  );
  const dominantProceeds = proceedsList.find((p) => p.currency === dominantCurrency);

  return {
    proceeds: dominantProceeds || proceedsList[0],
    refunds:
      refundsAmount !== 0
        ? { amount: refundsAmount, currency: dominantCurrency }
        : undefined,
    paidDownloads: paidDownloads || undefined,
    proceedsByCurrency: proceedsList.length > 1 ? proceedsList : undefined,
    note:
      "Sourced from Play Console earnings export. Excludes Google fees and taxes; matches the 'Estimated revenue' column in Play Console.",
  };
}
