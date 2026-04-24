import type { IapProductStat, IapSummary, SubscriptionGroupStat, SubscriptionsSummary } from "../types";
import { gpFetchJson, GooglePlayApiError } from "./client";

// Play Developer API v3 exposes the *catalog* of in-app products and
// subscriptions but not per-day sales (that's Play Console's Financial
// reports → Cloud Storage bucket, which we intentionally skipped in scope).
// We surface the catalog as a product list with no units/proceeds so the UI
// at least shows what's for sale. The Subscriptions panel does the same: one
// row per base plan with no activeSubscribers / renewals counts, annotated.

interface PlayInappProduct {
  packageName?: string;
  sku?: string;
  status?: string;
  listings?: Record<string, { title?: string; description?: string }>;
  defaultLanguage?: string;
  defaultPrice?: { priceMicros?: string; currency?: string };
  prices?: Record<string, { priceMicros?: string; currency?: string }>;
}

interface InappProductsListResponse {
  inappproduct?: PlayInappProduct[];
  tokenPagination?: { nextPageToken?: string };
}

interface PlaySubscription {
  productId?: string;
  packageName?: string;
  basePlans?: Array<{
    basePlanId?: string;
    state?: string;
    autoRenewingBasePlanType?: {
      billingPeriodDuration?: string;
    };
    regionalConfigs?: Array<{ regionCode?: string; price?: { currencyCode?: string } }>;
  }>;
  listings?: Array<{ languageCode?: string; title?: string; description?: string }>;
}

interface SubscriptionsListResponse {
  subscriptions?: PlaySubscription[];
  nextPageToken?: string;
}

function catalogTitle(p: PlayInappProduct): string | undefined {
  const lang = p.defaultLanguage || "en-US";
  return p.listings?.[lang]?.title || Object.values(p.listings || {})[0]?.title;
}

export async function getIapCatalog(
  pkg: string,
): Promise<{ summary?: IapSummary; warning?: string }> {
  try {
    const collected: PlayInappProduct[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res: InappProductsListResponse = await gpFetchJson<InappProductsListResponse>(
        `/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/inappproducts`,
        { query: { maxResults: 100, token: pageToken } },
      );
      for (const p of res.inappproduct || []) collected.push(p);
      pageToken = res.tokenPagination?.nextPageToken;
      if (!pageToken) break;
    }

    if (!collected.length) return { summary: undefined };

    const products: IapProductStat[] = collected.map((p) => ({
      sku: p.sku || "—",
      name: catalogTitle(p),
      // Without Financial reports we have no units/proceeds; the panel will
      // show a dash for both columns. That's honest — better than making
      // numbers up.
      units: 0,
    }));

    return {
      summary: { products, totalUnits: 0 },
      warning:
        "Google Play IAP sales totals aren't in the Developer API — only the catalog. Showing product list; unit & revenue totals need the Play Console Financial CSV export.",
    };
  } catch (err) {
    if (err instanceof GooglePlayApiError && err.status === 404) {
      return { summary: undefined };
    }
    throw err;
  }
}

function subscriptionTitle(s: PlaySubscription): string {
  return (
    s.listings?.find((l) => l.languageCode === "en-US")?.title ||
    s.listings?.[0]?.title ||
    s.productId ||
    "—"
  );
}

export async function getSubscriptionCatalog(
  pkg: string,
): Promise<{ summary?: SubscriptionsSummary; warning?: string }> {
  try {
    const collected: PlaySubscription[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res: SubscriptionsListResponse = await gpFetchJson<SubscriptionsListResponse>(
        `/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/monetization/subscriptions`,
        { query: { pageSize: 100, pageToken } },
      );
      for (const s of res.subscriptions || []) collected.push(s);
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }

    if (!collected.length) return { summary: undefined };

    // One row per subscription (not base plan) — dashboards map best to the
    // "Subscription group" concept, which on Play is effectively the
    // productId because Play doesn't have the same group abstraction as iOS.
    const groups: SubscriptionGroupStat[] = collected.map((s) => ({
      groupName: subscriptionTitle(s),
      // No real counts until Financial CSV is wired in — show the base-plan
      // count as a proxy so the row isn't empty.
      activeSubscribers: undefined,
      newSubscriptions: undefined,
      renewals: undefined,
      cancellations: undefined,
    }));

    return {
      summary: { groups },
      warning:
        "Google Play subscription activity (active / new / renewals / churn) needs the Play Console Financial CSV export. Showing catalog only.",
    };
  } catch (err) {
    if (err instanceof GooglePlayApiError && err.status === 404) {
      return { summary: undefined };
    }
    throw err;
  }
}
