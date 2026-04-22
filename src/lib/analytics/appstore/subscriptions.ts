import { gunzipSync } from "node:zlib";
import { ascFetchRaw, AppStoreApiError } from "./client";
import type { MoneyAmount, SubscriptionGroupStat, SubscriptionsSummary } from "../types";

// Sales & Trends has two subscription-related report types:
//   - SUBSCRIPTION (daily): snapshot of every subscription (active paid, free trial, etc.)
//   - SUBSCRIPTION_EVENT (daily): each customer event (Subscribe, Renew, Cancel, ...)
// Both are gzipped TSV. They're only populated once the app has subscriptions.

interface SubscriptionRow {
  "App Name"?: string;
  "App Apple ID"?: string;
  "Subscription Name"?: string;
  "Subscription Apple ID"?: string;
  "Subscription Group ID"?: string;
  "Subscription Group Name"?: string;
  "Standard Subscription Duration"?: string;
  "Promotional Offer Name"?: string;
  "Promotional Offer ID"?: string;
  "Customer Price"?: string;
  "Customer Currency"?: string;
  "Developer Proceeds"?: string;
  "Proceeds Currency"?: string;
  "Preserved Pricing"?: string;
  "Proceeds Reason"?: string;
  "Client"?: string;
  "Device"?: string;
  "State"?: string;
  "Country"?: string;
  "Active Standard Price Subscriptions"?: string;
  "Active Free Trial Introductory Offer Subscriptions"?: string;
  "Active Pay Up Front Introductory Offer Subscriptions"?: string;
  "Active Pay As You Go Introductory Offer Subscriptions"?: string;
  "Free Trial Promotional Offer Subscriptions"?: string;
  "Pay Up Front Promotional Offer Subscriptions"?: string;
  "Pay As You Go Promotional Offer Subscriptions"?: string;
  "Other Active Subscriptions"?: string;
  "Marketing Opt-Ins"?: string;
  "Billing Retry"?: string;
  "Grace Period"?: string;
  "Quantity"?: string;
  "Units"?: string;
  "Event"?: string;
  [k: string]: string | undefined;
}

function parseTsv(text: string): SubscriptionRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: SubscriptionRow = {};
    headers.forEach((h, i) => {
      row[h] = cols[i];
    });
    return row;
  });
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function apiDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchSubscriptionReport(
  reportType: "SUBSCRIPTION" | "SUBSCRIPTION_EVENT",
  vendorNumber: string,
  date: Date,
): Promise<SubscriptionRow[] | null> {
  try {
    const res = await ascFetchRaw("/v1/salesReports", {
      acceptGzip: true,
      query: {
        "filter[frequency]": "DAILY",
        "filter[reportType]": reportType,
        "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]": vendorNumber,
        "filter[reportDate]": apiDateString(date),
        "filter[version]": "1_3",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = gunzipSync(buf).toString("utf8");
    return parseTsv(text);
  } catch (err) {
    if (err instanceof AppStoreApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

interface GroupAccumulator {
  groupName: string;
  activePaid: number;
  activeTrial: number;
  activePromo: number;
  otherActive: number;
  billingRetry: number;
  grace: number;
  subscribes: number;
  renews: number;
  cancels: number;
  refunds: number;
  reactivates: number;
  proceedsByCurrency: Record<string, number>;
}

function emptyGroup(name: string): GroupAccumulator {
  return {
    groupName: name,
    activePaid: 0,
    activeTrial: 0,
    activePromo: 0,
    otherActive: 0,
    billingRetry: 0,
    grace: 0,
    subscribes: 0,
    renews: 0,
    cancels: 0,
    refunds: 0,
    reactivates: 0,
    proceedsByCurrency: {},
  };
}

function groupKey(r: SubscriptionRow): string {
  return (
    r["Subscription Group Name"] ||
    r["Subscription Group ID"] ||
    r["Subscription Name"] ||
    "Unknown group"
  );
}

function ingestSnapshot(
  groups: Record<string, GroupAccumulator>,
  r: SubscriptionRow,
  appId: string,
): void {
  if (r["App Apple ID"] !== appId) return;
  const key = groupKey(r);
  if (!groups[key]) groups[key] = emptyGroup(key);
  const g = groups[key];
  g.activePaid += num(r["Active Standard Price Subscriptions"]);
  g.activeTrial +=
    num(r["Active Free Trial Introductory Offer Subscriptions"]) +
    num(r["Free Trial Promotional Offer Subscriptions"]);
  g.activePromo +=
    num(r["Active Pay Up Front Introductory Offer Subscriptions"]) +
    num(r["Active Pay As You Go Introductory Offer Subscriptions"]) +
    num(r["Pay Up Front Promotional Offer Subscriptions"]) +
    num(r["Pay As You Go Promotional Offer Subscriptions"]);
  g.otherActive += num(r["Other Active Subscriptions"]);
  g.billingRetry += num(r["Billing Retry"]);
  g.grace += num(r["Grace Period"]);
}

function ingestEvent(
  groups: Record<string, GroupAccumulator>,
  r: SubscriptionRow,
  appId: string,
): void {
  if (r["App Apple ID"] !== appId) return;
  const key = groupKey(r);
  if (!groups[key]) groups[key] = emptyGroup(key);
  const g = groups[key];
  const ev = (r.Event || "").toLowerCase();
  const qty = num(r.Quantity) || num(r.Units) || 1;
  if (/^subscribe/.test(ev)) g.subscribes += qty;
  else if (/renew/.test(ev)) g.renews += qty;
  else if (/^cancel/.test(ev)) g.cancels += qty;
  else if (/^refund/.test(ev)) g.refunds += qty;
  else if (/^reactivate/.test(ev)) g.reactivates += qty;

  // Events carry Developer Proceeds too (for renewals/refunds). Accumulate.
  const proc = num(r["Developer Proceeds"]);
  const currency = r["Proceeds Currency"] || r["Customer Currency"] || "USD";
  if (proc) {
    g.proceedsByCurrency[currency] = (g.proceedsByCurrency[currency] || 0) + proc * qty;
  }
}

function dominantCurrency(totals: Record<string, number>): string | undefined {
  return Object.entries(totals).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0];
}

function finalizeGroup(g: GroupAccumulator): SubscriptionGroupStat {
  const active = g.activePaid + g.activeTrial + g.activePromo + g.otherActive;
  const dom = dominantCurrency(g.proceedsByCurrency);
  const proceeds: MoneyAmount | undefined = dom
    ? { currency: dom, amount: Number((g.proceedsByCurrency[dom] || 0).toFixed(2)) }
    : undefined;
  return {
    groupName: g.groupName,
    activeSubscribers: active,
    newSubscriptions: g.subscribes,
    renewals: g.renews,
    cancellations: g.cancels,
    billingRetry: g.billingRetry,
    grace: g.grace,
    proceeds,
    churnRate: active > 0 ? g.cancels / active : undefined,
  };
}

export async function getSubscriptionsSummary(
  appId: string,
  vendorNumber: string,
  days = 7,
): Promise<{ snapshot: SubscriptionsSummary | null; warning?: string }> {
  // Snapshot: most recent available day. Events: last `days` days aggregated.
  const now = new Date();
  const snapshotDates: Date[] = [];
  const eventDates: Date[] = [];
  for (let offset = 1; offset <= days; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    eventDates.push(d);
    if (offset <= 3) snapshotDates.push(d); // try a few days in case yesterday isn't ready
  }

  const [snapshotsRaw, eventsRaw] = await Promise.all([
    Promise.all(snapshotDates.map((d) => fetchSubscriptionReport("SUBSCRIPTION", vendorNumber, d))),
    Promise.all(
      eventDates.map((d) => fetchSubscriptionReport("SUBSCRIPTION_EVENT", vendorNumber, d)),
    ),
  ]);

  const groups: Record<string, GroupAccumulator> = {};

  // Pick the most recent non-empty snapshot report.
  const latestSnapshot = snapshotsRaw.find((rows) => rows && rows.length);
  if (latestSnapshot) {
    for (const r of latestSnapshot) ingestSnapshot(groups, r, appId);
  }

  for (const rows of eventsRaw) {
    for (const r of rows || []) ingestEvent(groups, r, appId);
  }

  const keys = Object.keys(groups);
  if (!keys.length) {
    return {
      snapshot: null,
      warning:
        "No subscription reports returned. Either this app has no subscriptions yet, or Apple hasn't processed recent days.",
    };
  }

  const groupStats = keys.map((k) => finalizeGroup(groups[k]));
  const totalActive = groupStats.reduce((s, g) => s + (g.activeSubscribers || 0), 0);

  // Sum total proceeds across groups in the dominant currency.
  const byCurrency: Record<string, number> = {};
  for (const g of Object.values(groups)) {
    for (const [c, amt] of Object.entries(g.proceedsByCurrency)) {
      byCurrency[c] = (byCurrency[c] || 0) + amt;
    }
  }
  const domCurr = dominantCurrency(byCurrency);
  const totalProceeds: MoneyAmount | undefined = domCurr
    ? { currency: domCurr, amount: Number((byCurrency[domCurr] || 0).toFixed(2)) }
    : undefined;

  return {
    snapshot: {
      groups: groupStats.sort(
        (a, b) => (b.activeSubscribers || 0) - (a.activeSubscribers || 0),
      ),
      totalActive,
      totalProceeds,
    },
  };
}
