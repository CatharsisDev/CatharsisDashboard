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

  return {
    clientEmail: parsed.client_email,
    privateKey: normalizePrivateKey(parsed.private_key),
    privateKeyId: parsed.private_key_id,
    tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token",
    packageName,
  };
}
