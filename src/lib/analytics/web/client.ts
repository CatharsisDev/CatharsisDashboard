import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  loadCredentialsFromEnv as loadServiceAccountFromEnv,
  loadUserOAuthFromEnv,
  type GooglePlayCredentials,
  type GoogleUserOAuthCredentials,
} from "../googleplay/credentials";
import { loadWebConfigFromEnv, type WebAnalyticsConfig } from "./credentials";

// GA4 Data API v1beta — runs ad-hoc reports against a property. Docs:
//   https://developers.google.com/analytics/devguides/reporting/data/v1
// We POST to `/v1beta/properties/{propertyId}:runReport` with a body listing
// the dimensions + metrics we want. One report per panel keeps each call
// cheap and lets us catch failures per-panel rather than crashing the page.

const GA4_BASE = "https://analyticsdata.googleapis.com";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export class GoogleAnalyticsApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`GA4 Data API ${status}: ${body.slice(0, 300)}`);
    this.name = "GoogleAnalyticsApiError";
    this.status = status;
    this.body = body;
  }
}

// ---- token cache (per refresh-token clientId, like the bucket flow) ----
//
// We keep this cache local to the module instead of sharing with the Play
// bucket cache because the access tokens differ in scope: the Play bucket
// flow only needs devstorage.read_only, while GA4 needs analytics.readonly.
// In practice the *same* refresh token can mint either (provided it was
// granted both scopes at consent time), but caching them separately means a
// scope mismatch on one doesn't poison the other.
let cachedToken: { token: string; expiresAt: number; forClientId: string } | null = null;

async function exchangeRefreshTokenForUserToken(
  creds: GoogleUserOAuthCredentials,
): Promise<{ token: string; expiresAt: number; forClientId: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // Most common 400 here: invalid_scope. Means the refresh token wasn't
    // minted with analytics.readonly. Setup screen documents the fix.
    throw new GoogleAnalyticsApiError(res.status, text);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new GoogleAnalyticsApiError(500, `Refresh-token response missing access_token: ${text}`);
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3500;
  return {
    token: json.access_token,
    // 60s safety margin so a slow request doesn't land with an expired token.
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn - 60,
    forClientId: creds.clientId,
  };
}

async function getUserAccessToken(creds: GoogleUserOAuthCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedToken &&
    cachedToken.forClientId === creds.clientId &&
    cachedToken.expiresAt > now
  ) {
    return cachedToken.token;
  }
  cachedToken = await exchangeRefreshTokenForUserToken(creds);
  return cachedToken.token;
}

// ---- service-account JWT flow (preferred for GA4) ----------------------
//
// Google's risk-based auth blocks the gcloud-shipped OAuth client when it
// asks for `analytics.readonly` (it's a sensitive scope and gcloud's client
// isn't verified for it). Service accounts sidestep the consent screen
// entirely — they sign a JWT, exchange it for an access token, and Google
// trusts whichever scopes the JWT requests as long as the SA is granted
// the corresponding access on the resource.
//
// For GA4 the only setup step is: GA4 → Admin → Property access management
// → add the service-account email (the `client_email` from the SA JSON) as
// a Viewer. We reuse the Play service account by default; setting
// GA4_SERVICE_ACCOUNT_JSON{,_BASE64} overrides that with a dedicated SA.

let cachedKey: { pem: string; keyObject: KeyObject } | null = null;

function loadPrivateKey(pem: string): KeyObject {
  if (cachedKey && cachedKey.pem === pem) return cachedKey.keyObject;
  const keyObject = createPrivateKey({ key: pem, format: "pem" });
  cachedKey = { pem, keyObject };
  return keyObject;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(creds: GooglePlayCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const header: Record<string, unknown> = { alg: "RS256", typ: "JWT" };
  if (creds.privateKeyId) header.kid = creds.privateKeyId;
  const payload = {
    iss: creds.clientEmail,
    scope: ANALYTICS_SCOPE,
    aud: creds.tokenUri,
    iat: now,
    exp,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const keyObject = loadPrivateKey(creds.privateKey);
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), keyObject);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

let cachedSaToken: { token: string; expiresAt: number; forEmail: string } | null = null;

async function exchangeJwtForToken(
  creds: GooglePlayCredentials,
): Promise<{ token: string; expiresAt: number; forEmail: string }> {
  const jwt = signJwt(creds);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(creds.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // Most common 400 here: invalid_scope (the SA's project doesn't have the
    // Analytics API enabled — fix is `gcloud services enable
    // analyticsdata.googleapis.com`). Surface the error description verbatim.
    throw new GoogleAnalyticsApiError(res.status, text);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new GoogleAnalyticsApiError(500, `Token response missing access_token: ${text}`);
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3500;
  return {
    token: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn - 60,
    forEmail: creds.clientEmail,
  };
}

async function getServiceAccountAccessToken(
  creds: GooglePlayCredentials,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedSaToken &&
    cachedSaToken.forEmail === creds.clientEmail &&
    cachedSaToken.expiresAt > now
  ) {
    return cachedSaToken.token;
  }
  cachedSaToken = await exchangeJwtForToken(creds);
  return cachedSaToken.token;
}

/**
 * Pick whichever Google credential is most likely to work. Order:
 *   1. GA4-specific service account (GA4_SERVICE_ACCOUNT_JSON{,_BASE64})
 *      — only set if you want to isolate GA4 from Play.
 *   2. Reused Play service account (the default — we already have its
 *      private key, just add its email as a Viewer in GA4).
 *   3. gcloud user-OAuth refresh token — fallback, often blocked by Google
 *      because gcloud's OAuth client isn't verified for analytics scope.
 */
function loadGa4ServiceAccount(): GooglePlayCredentials | null {
  // Optional GA4-only override — same JSON shape as the Play SA, but keyed
  // separately so users can rotate them independently.
  const dedicatedRaw =
    process.env.GA4_SERVICE_ACCOUNT_JSON ||
    process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64;
  if (dedicatedRaw) {
    // Reuse the Play SA loader by temporarily swapping the env var, since
    // the loader keys off GOOGLEPLAY_SERVICE_ACCOUNT_JSON. Cleanest path
    // without duplicating the whole parser; we restore env afterwards.
    const prevJson = process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON;
    const prevB64 = process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64;
    const prevPkg = process.env.GOOGLEPLAY_PACKAGE_NAME;
    try {
      if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
        process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON = process.env.GA4_SERVICE_ACCOUNT_JSON;
        delete process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64;
      } else {
        process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64 =
          process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64;
        delete process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON;
      }
      // Loader requires GOOGLEPLAY_PACKAGE_NAME; we don't care about it for
      // GA4, but the loader returns null without it.
      process.env.GOOGLEPLAY_PACKAGE_NAME = prevPkg || "ga4-only";
      return loadServiceAccountFromEnv();
    } finally {
      process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON = prevJson;
      process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64 = prevB64;
      if (prevPkg === undefined) delete process.env.GOOGLEPLAY_PACKAGE_NAME;
      else process.env.GOOGLEPLAY_PACKAGE_NAME = prevPkg;
    }
  }
  // No dedicated SA: try to reuse the Play SA. Both have the same JSON shape
  // and the analytics.readonly scope only needs the email to be granted
  // Viewer in GA4 — not the SA's project to host any GA4 resources.
  return loadServiceAccountFromEnv();
}

async function getAccessToken(): Promise<string> {
  // Service account first — it sidesteps Google's risk-based block on the
  // gcloud-shipped OAuth client for the analytics scope.
  const sa = loadGa4ServiceAccount();
  if (sa) return getServiceAccountAccessToken(sa);

  // Fall back to user-OAuth (only works if the refresh token was minted with
  // analytics.readonly, AND Google didn't block the consent because of the
  // sensitive scope).
  const userCreds = loadUserOAuthFromEnv();
  if (userCreds) return getUserAccessToken(userCreds);

  throw new GoogleAnalyticsApiError(
    401,
    "No GA4 credentials configured. Set GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64 " +
      "(reuse the Play SA — recommended) or GA4_SERVICE_ACCOUNT_JSON_BASE64 " +
      "(dedicated GA4 SA). User-OAuth is also supported but Google often blocks " +
      "the analytics.readonly scope on gcloud's OAuth client.",
  );
}

/**
 * Returns a label for the auth method that's about to be used, so the page
 * can show "Authenticated as the Play service account" instead of guessing.
 */
export function describeWebAuth(): { method: "service-account" | "user-oauth" | "none"; label: string } {
  try {
    const sa = loadGa4ServiceAccount();
    if (sa) {
      return {
        method: "service-account",
        label: process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64
          ? `dedicated SA (${sa.clientEmail})`
          : `Play SA (${sa.clientEmail})`,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const u = loadUserOAuthFromEnv();
    if (u) return { method: "user-oauth", label: `gcloud user (${u.clientId.slice(0, 12)}…)` };
  } catch {
    /* fall through */
  }
  return { method: "none", label: "not configured" };
}

export function ensureWebConfig(): WebAnalyticsConfig {
  const cfg = loadWebConfigFromEnv();
  if (!cfg) throw new Error("GA4_PROPERTY_ID is not configured");
  return cfg;
}

/** True when both auth + property ID are present and parse cleanly. */
export function isWebConfigured(): boolean {
  try {
    const cfg = loadWebConfigFromEnv();
    if (!cfg) return false;
    // Either auth path is fine — service account is preferred but user-OAuth
    // is still supported for users who got past Google's risk-based block.
    const sa = loadGa4ServiceAccount();
    if (sa) return true;
    const userCreds = loadUserOAuthFromEnv();
    return !!userCreds;
  } catch {
    return false;
  }
}

// ---- runReport helper ---------------------------------------------------

export interface DateRange {
  startDate: string;     // YYYY-MM-DD or relative ("30daysAgo")
  endDate: string;       // YYYY-MM-DD or "today"
}

export interface RunReportRequest {
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dateRanges: DateRange[];
  /** GA4 supports up to 250k rows per request; we cap much lower for table panels. */
  limit?: number;
  /** Order results by a metric/dimension, descending by default. */
  orderBys?: Array<
    | { metric: { metricName: string }; desc?: boolean }
    | { dimension: { dimensionName: string; orderType?: string }; desc?: boolean }
  >;
  /** GA4 dimensionFilter — see https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/FilterExpression */
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  keepEmptyRows?: boolean;
}

export interface RunReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: Array<{
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }>;
  rowCount?: number;
  metadata?: { currencyCode?: string; timeZone?: string };
  totals?: Array<{ metricValues?: { value?: string }[] }>;
}

/**
 * POST a single GA4 runReport. Throws on non-2xx. The caller is expected to
 * wrap this in a try/catch and append a warning rather than letting one
 * failed panel collapse the whole page.
 */
export async function runReport(
  propertyId: string,
  body: RunReportRequest,
): Promise<RunReportResponse> {
  const token = await getAccessToken();
  const url = `${GA4_BASE}/v1beta/properties/${propertyId}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GoogleAnalyticsApiError(res.status, await res.text().catch(() => ""));
  }
  return (await res.json()) as RunReportResponse;
}

/**
 * Convenience: pull a single scalar metric value from a runReport response.
 * Returns undefined when the row/column is missing rather than throwing —
 * GA4 omits metrics that have no data in the period.
 */
export function pickMetric(
  res: RunReportResponse,
  metricName: string,
): number | undefined {
  const idx = res.metricHeaders?.findIndex((h) => h.name === metricName) ?? -1;
  if (idx < 0) return undefined;
  // For unaggregated reports the value lives on the first (and only) row;
  // for grouped reports the caller should iterate rows itself.
  const v = res.rows?.[0]?.metricValues?.[idx]?.value;
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
