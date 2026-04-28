// Google Cloud service-account credentials live in a single JSON blob you
// download from console.cloud.google.com → IAM → Service accounts → Keys.
// The two fields we actually need to mint OAuth tokens are `client_email` and
// `private_key`; we keep the rest around in case Google adds more required
// fields or the user wants to rotate via private_key_id.
//
// Pasting that JSON straight into Vercel's env-var UI is a footgun — the
// `private_key` field contains real `\n` newlines that get eaten by various
// pipelines. We accept *either*:
//   GOOGLEPLAY_SERVICE_ACCOUNT_JSON         — raw JSON, or with `\n` escapes
//   GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64  — `base64 -i sa.json` output
// Base64 is the safe option; raw JSON is the convenient one.

export interface GooglePlayCredentials {
  clientEmail: string;
  /** PEM-encoded RSA private key (with -----BEGIN PRIVATE KEY----- header). */
  privateKey: string;
  privateKeyId?: string;
  tokenUri: string;
  packageName: string;
  /**
   * The GCS bucket Google auto-creates for Play Console exports, of the form
   * `pubsite_prod_NNNNNNNNNNNNN`. Optional — when set, the dashboard fills
   * installs / territories / devices / finance from the daily CSV exports.
   * Without it those panels stay empty and the warning explains why.
   */
  statsBucket?: string;
}

interface ServiceAccountJson {
  type?: string;
  client_email?: string;
  private_key?: string;
  private_key_id?: string;
  token_uri?: string;
  project_id?: string;
}

function parseServiceAccountBlob(raw: string): ServiceAccountJson {
  let s = raw.trim();
  if (!s) throw new Error("Service-account JSON is empty");

  // Strip surrounding quotes (someone pasted `"{...}"`).
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // If it doesn't smell like JSON, try base64 first.
  if (!s.startsWith("{")) {
    try {
      const decoded = Buffer.from(s, "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) s = decoded;
    } catch {
      /* fall through */
    }
  }

  // Try parsing as-is FIRST. Standard service-account JSON has its newlines
  // escaped as `\n` inside the private_key string, which JSON.parse handles
  // natively. We don't pre-mutate the string — that used to corrupt valid
  // JSON by turning `\n` escapes into real newlines, which JSON disallows
  // inside string literals.
  try {
    return JSON.parse(s) as ServiceAccountJson;
  } catch (firstErr) {
    // Recovery #1: literal control characters (real newlines/tabs) appear
    // *inside* string literals. Common when an env-var pipeline silently
    // unescaped \n into raw newlines. Re-escape them.
    const reEscaped = escapeControlsInsideJsonStrings(s);
    if (reEscaped !== s) {
      try {
        return JSON.parse(reEscaped) as ServiceAccountJson;
      } catch {
        /* fall through */
      }
    }

    // Recovery #2: literal `\n` two-char sequences appear *outside* string
    // literals (rare double-escape). Convert and try once more.
    if (s.includes("\\n")) {
      try {
        return JSON.parse(s.replace(/\\n/g, "\n")) as ServiceAccountJson;
      } catch {
        /* fall through */
      }
    }

    const detail = firstErr instanceof Error ? firstErr.message : String(firstErr);
    throw new Error(
      `Could not parse Google service-account JSON: ${detail}. ` +
        "Easiest fix: base64-encode the downloaded sa.json file with " +
        "`base64 -i sa.json | tr -d '\\n' | pbcopy` and paste it into " +
        "GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64 instead.",
    );
  }
}

// Walk the string with a tiny state machine and escape \n, \r, \t that
// appear inside JSON string literals. Structural characters and content
// outside strings are passed through untouched. Used as a recovery path
// when the env-var transport mangled the original JSON's escape sequences.
function escapeControlsInsideJsonStrings(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    // inside a string literal
    if (c === "\\") {
      // Pass through any escape sequence verbatim (including \" \\ \/ \n \t).
      out += c;
      const next = s[i + 1];
      if (next !== undefined) {
        out += next;
        i++;
      }
      continue;
    }
    if (c === '"') {
      inString = false;
      out += c;
      continue;
    }
    if (c === "\n") { out += "\\n"; continue; }
    if (c === "\r") { out += "\\r"; continue; }
    if (c === "\t") { out += "\\t"; continue; }
    out += c;
  }
  return out;
}

function normalizePrivateKey(raw: string): string {
  // The private_key field arrives as a single string in JSON, with `\n` as
  // line separators. Once parsed it might already have real newlines (raw
  // JSON paste) or still have literal `\n` (escaped twice somewhere).
  let s = raw;
  if (!s.includes("\n") && s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return s.trim();
}

/**
 * Personal-account OAuth credentials produced by `gcloud auth
 * application-default login`. We use these only as a fallback for the
 * Cloud Storage bucket calls when the service account can't be granted
 * `Storage Object Viewer` on the Play Console export bucket — that bucket
 * lives in a Google-managed project and only the developer-account *Account
 * Owner* can grant IAM on it. The user's own account is allowed to read it
 * implicitly via Play Console permissions, so we ride on those creds.
 *
 * Credential file shape (after `gcloud auth application-default login`):
 *   {
 *     "client_id": "...apps.googleusercontent.com",
 *     "client_secret": "...",
 *     "refresh_token": "...",
 *     "type": "authorized_user"
 *   }
 *
 * We accept it via:
 *   GOOGLEPLAY_USER_OAUTH_JSON          — raw JSON, or with `\n` escapes
 *   GOOGLEPLAY_USER_OAUTH_JSON_BASE64   — `base64 -i adc.json` output
 */
export interface GoogleUserOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUri: string;
}

interface UserOAuthJson {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  type?: string;
}

export function loadUserOAuthFromEnv(): GoogleUserOAuthCredentials | null {
  const raw =
    process.env.GOOGLEPLAY_USER_OAUTH_JSON ||
    process.env.GOOGLEPLAY_USER_OAUTH_JSON_BASE64;
  if (!raw) return null;

  // Reuse the same robust JSON parser we use for service-account JSON,
  // since it has identical "Vercel mangled my newlines" failure modes.
  const parsed = parseServiceAccountBlob(raw) as unknown as UserOAuthJson;
  if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) {
    throw new Error(
      "User-OAuth JSON is missing client_id / client_secret / refresh_token. " +
        "Run `gcloud auth application-default login` and copy the file at " +
        "~/.config/gcloud/application_default_credentials.json verbatim into " +
        "GOOGLEPLAY_USER_OAUTH_JSON_BASE64.",
    );
  }
  return {
    clientId: parsed.client_id,
    clientSecret: parsed.client_secret,
    refreshToken: parsed.refresh_token,
    tokenUri: "https://oauth2.googleapis.com/token",
  };
}

export function loadCredentialsFromEnv(): GooglePlayCredentials | null {
  const raw =
    process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64;
  const packageName = process.env.GOOGLEPLAY_PACKAGE_NAME;
  if (!raw || !packageName) return null;

  const parsed = parseServiceAccountBlob(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service-account JSON is missing client_email or private_key. " +
        "Download a fresh JSON key from Google Cloud → IAM → Service accounts → Keys.",
    );
  }

  // Strip a possible leading `gs://` prefix and any stray slashes so callers
  // can pass either form. Empty string → undefined so optional checks work.
  let statsBucket = process.env.GOOGLEPLAY_STATS_BUCKET?.trim() || undefined;
  if (statsBucket?.startsWith("gs://")) statsBucket = statsBucket.slice(5);
  if (statsBucket) statsBucket = statsBucket.replace(/^\/+|\/+$/g, "");

  return {
    clientEmail: parsed.client_email,
    privateKey: normalizePrivateKey(parsed.private_key),
    privateKeyId: parsed.private_key_id,
    tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token",
    packageName,
    statsBucket,
  };
}
