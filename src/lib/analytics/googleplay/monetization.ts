import type { IapProductStat, IapSummary, SubscriptionGroupStat, SubscriptionsSummary } from "../types";
import { gpFetchJson, GooglePlayApiError } from "./client";

// Play Developer API v3 exposes the *catalog* of in-app products and
// subscriptions but not per-day sales (that's Play Console's Financial
// reports → Cloud Storage bucket, which we intentionally skipped in scope).
// We surface the catalog as a product list with no units/proceeds so the UI
// at least shows what's for sale. The Subscriptions panel does the same: one
// row per base plan with no activeSubscribers / renewals counts, annotated.

// Two product representations: the legacy `inappproducts` API (now hard
// 403'd with "Please migrate to the new publishing API" on most accounts),
// and the new `monetization.onetimeproducts` API which is the supported
// replacement. We try the new one first and fall back only on a clean 404.

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

interface OneTimeProductListing {
  languageCode?: string;
  title?: string;
  description?: string;
}

interface OneTimeProduct {
  productId?: string;
  packageName?: string;
  listings?: OneTimeProductListing[];
  purchaseOptions?: Array<{
    purchaseOptionId?: string;
    state?: string;
  }>;
}

interface OneTimeProductsListResponse {
  oneTimeProducts?: OneTimeProduct[];
  nextPageToken?: string;
}

function oneTimeTitle(p: OneTimeProduct): string | undefined {
  return (
    p.listings?.find((l) => l.languageCode === "en-US")?.title ||
    p.listings?.[0]?.title ||
    p.productId
  );
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

async function fetchOneTimeProducts(pkg: string): Promise<OneTimeProduct[] | null> {
  try {
    const collected: OneTimeProduct[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res: OneTimeProductsListResponse = await gpFetchJson<OneTimeProductsListResponse>(
        `/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/onetimeproducts`,
        { query: { pageSize: 100, pageToken } },
      );
      for (const p of res.oneTimeProducts || []) collected.push(p);
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return collected;
  } catch (err) {
    // 404 means the new endpoint isn't available for this account yet (it
    // rolled out in waves). Fall back to the legacy inappproducts endpoint.
    if (err instanceof GooglePlayApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchLegacyInappProducts(pkg: string): Promise<PlayInappProduct[]> {
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
  return collected;
}

export async function getIapCatalog(
  pkg: string,
): Promise<{ summary?: IapSummary; warning?: string }> {
  try {
    // Prefer the new monetization.onetimeproducts API. The old inappproducts
    // endpoint is being deprecated and now returns 403 "Please migrate to
    // the new publishing API" on many accounts.
    const oneTime = await fetchOneTimeProducts(pkg);

    let products: IapProductStat[] = [];
    if (oneTime && oneTime.length) {
      products = oneTime.map((p) => ({
        sku: p.productId || "—",
        name: oneTimeTitle(p),
        units: 0,
      }));
    } else if (oneTime === null) {
      // New endpoint 404'd — try the legacy one as a fallback. It may also
      // 403, in which case the outer catch surfaces it as a warning.
      const legacy = await fetchLegacyInappProducts(pkg);
      products = legacy.map((p) => ({
        sku: p.sku || "—",
        name: catalogTitle(p),
        units: 0,
      }));
    }

    if (!products.length) return { summary: undefined };

    return {
      summary: { products, totalUnits: 0 },
      warning:
        "Google Play IAP sales totals aren't in the Developer API — only the catalog. Showing product list; unit & revenue totals need the Play Console Financial CSV export.",
    };
  } catch (err) {
    if (err instanceof GooglePlayApiError && err.status === 404) {
      return { summary: undefined };
    }
    if (err instanceof GooglePlayApiError && err.status === 403) {
      // No IAP read permission on this service account, or the app has no
      // IAP catalog at all. Surface as a warning rather than crashing the
      // whole snapshot.
      return {
        summary: undefined,
        warning:
          "Google Play IAP catalog unavailable (403). Either the app has no in-app products, or the service account is missing 'View financial data' permission in Play Console.",
      };
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
