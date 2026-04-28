import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { loadCredentialsFromEnv, type GooglePlayCredentials } from "./credentials";

// Google service-account JWT spec (signed JWT bearer token grant):
//   Header:  { alg: "RS256", typ: "JWT", kid?: <private_key_id> }
//   Payload: { iss: <client_email>, scope: <space-sep>, aud: <token_uri>,
//              exp: now+3600, iat: now }
//   Signature: RS256 (RSA-PKCS#1 v1.5 with SHA-256) over the signing input,
//              using the service account's RSA private key.
//
// We POST that JWT as `assertion` to oauth2.googleapis.com/token with
// grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, and Google hands
// back an access_token good for 1h. We cache the access token (NOT the JWT)
// in-process and refresh ~60s before expiry.

// All three APIs we call need their own scope. Asking for all up-front means
// a single token works for everything in the snapshot:
//   * androidpublisher        — apps, reviews, IAP, subscriptions
//   * playdeveloperreporting  — vitals (crashes, ANRs, slow start, ...)
//   * devstorage.read_only    — Play Console Statistics / Financial CSVs
const SCOPES = [
  "https://www.googleapis.com/auth/androidpublisher",
  "https://www.googleapis.com/auth/playdeveloperreporting",
  "https://www.googleapis.com/auth/devstorage.read_only",
];

export class GooglePlayApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Google Play API ${status}: ${body.slice(0, 300)}`);
    this.name = "GooglePlayApiError";
    this.status = status;
    this.body = body;
  }
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedKey: { pem: string; keyObject: KeyObject } | null = null;

function loadPrivateKey(pem: string): KeyObject {
  if (cachedKey && cachedKey.pem === pem) return cachedKey.keyObject;
  try {
    const keyObject = createPrivateKey({ key: pem, format: "pem" });
    cachedKey = { pem, keyObject };
    return keyObject;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Google service-account private key could not be parsed: ${detail}. ` +
        "The `private_key` field inside the JSON is malformed — try the base64 " +
        "env variant (GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64) which avoids all " +
        "newline-escaping issues.",
    );
  }
}

function signJwt(creds: GooglePlayCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour, the max Google allows for service-account JWTs

  const header: Record<string, unknown> = { alg: "RS256", typ: "JWT" };
  if (creds.privateKeyId) header.kid = creds.privateKeyId;

  const payload = {
    iss: creds.clientEmail,
    scope: SCOPES.join(" "),
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

interface CachedToken {
  token: string;
  expiresAt: number;
  forEmail: string;
}
let cachedToken: CachedToken | null = null;

async function exchangeJwtForToken(creds: GooglePlayCredentials): Promise<CachedToken> {
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
    // Google returns a JSON error body like {"error": "invalid_grant", "error_description": "..."}.
    // Surface that directly because the description tells you whether the clock
    // is wrong, the key was rotated, the scope is unauthorized, etc.
    throw new GooglePlayApiError(res.status, text);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new GooglePlayApiError(500, `Token response missing access_token: ${text}`);
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3500;
  return {
    token: json.access_token,
    // Pad with a 60-second safety margin so a request that takes 5s to fly
    // doesn't land with an already-expired token.
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn - 60,
    forEmail: creds.clientEmail,
  };
}

async function getAccessToken(creds: GooglePlayCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedToken &&
    cachedToken.forEmail === creds.clientEmail &&
    cachedToken.expiresAt > now
  ) {
    return cachedToken.token;
  }
  cachedToken = await exchangeJwtForToken(creds);
  return cachedToken.token;
}

function ensureCreds(): GooglePlayCredentials {
  const creds = loadCredentialsFromEnv();
  if (!creds) throw new Error("Google Play credentials are not configured");
  return creds;
}

/** The configured Play Console package name (e.g. com.catharsis.cards). */
export function packageName(): string {
  return ensureCreds().packageName;
}

interface FetchOptions {
  method?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /** Override the API base URL — most of the Reporting API lives on a different host. */
  baseUrl?: string;
}

const PUBLISHER_BASE = "https://androidpublisher.googleapis.com";

function buildUrl(path: string, baseUrl: string, query?: FetchOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function gpFetchJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const creds = ensureCreds();
  const token = await getAccessToken(creds);
  const url = buildUrl(path, options.baseUrl || PUBLISHER_BASE, options.query);
  const init: RequestInit = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const res = await fetch(url, init);
  if (!res.ok) {
    throw new GooglePlayApiError(res.status, await res.text().catch(() => ""));
  }
  // Some endpoints (DELETE, certain :acknowledge calls) return 204 No Content.
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/**
 * Authenticated binary GET. Used for downloading Play Console CSV exports
 * from Cloud Storage — those come back as UTF-16 LE bytes that the caller
 * needs to decode itself.
 */
export async function gpFetchBytes(path: string, options: FetchOptions = {}): Promise<Buffer> {
  const creds = ensureCreds();
  const token = await getAccessToken(creds);
  const url = buildUrl(path, options.baseUrl || PUBLISHER_BASE, options.query);
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GooglePlayApiError(res.status, await res.text().catch(() => ""));
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
