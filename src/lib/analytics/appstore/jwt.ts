import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";

// App Store Connect JWT spec:
//   Header:  { alg: "ES256", kid: <Key ID>, typ: "JWT" }
//   Payload: { iss: <Issuer ID>, iat: now, exp: now+1200, aud: "appstoreconnect-v1" }
//   Signature: ES256 over `${header}.${payload}` using the .p8 EC P-256 private key,
//              encoded as raw R||S (IEEE P1363), not ASN.1/DER.
//
// Max validity per ASC docs is 20 minutes; we use 19 minutes for safety and cache
// the JWT in-process until ~30s before expiry.

export interface AppStoreCredentials {
  keyId: string;
  issuerId: string;
  /** The full .p8 PEM contents, including BEGIN/END lines. */
  privateKeyPem: string;
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
    // Turn the cryptic OpenSSL DECODER error into an actionable message that
    // names the most likely cause based on what the normalized value looks like.
    const detail = err instanceof Error ? err.message : String(err);
    const hasBegin = pem.includes("-----BEGIN");
    const hasEnd = pem.includes("-----END");
    const hasNewlines = pem.includes("\n");
    const startsWithQuote = /^["']/.test(pem);
    let hint: string;
    if (startsWithQuote) {
      hint = "The value starts with a quote character — you probably pasted `\"...\"` into Vercel. Remove the surrounding quotes (quotes are a .env file thing, not a Vercel UI thing) and redeploy.";
    } else if (!hasBegin || !hasEnd) {
      hint = "Missing `-----BEGIN PRIVATE KEY-----` or `-----END PRIVATE KEY-----` header. Paste the full contents of the .p8 file, including both header lines.";
    } else if (!hasNewlines) {
      hint = "The PEM is on a single line — newlines got stripped in transit. Easiest fix: base64-encode the .p8 file with `base64 -i AuthKey_XXX.p8 | pbcopy` and paste that into `APPSTORE_PRIVATE_KEY_BASE64` instead.";
    } else {
      hint = "PEM headers and newlines look correct but OpenSSL refused to decode the body. Likely a hidden character issue (BOM, smart quotes, em-dash substituted for `-----`, rich-text paste). Re-copy the .p8 from a plain-text editor, or use `APPSTORE_PRIVATE_KEY_BASE64` which side-steps all formatting pitfalls.";
    }
    throw new Error(`App Store Connect private key could not be parsed: ${detail}. ${hint}`);
  }
}

let cachedJwt: { token: string; expiresAt: number; kid: string } | null = null;

export function createAppStoreJWT(creds: AppStoreCredentials): string {
  const now = Math.floor(Date.now() / 1000);

  // Re-use an existing JWT if it still has >30s of life and matches the kid.
  if (cachedJwt && cachedJwt.kid === creds.keyId && cachedJwt.expiresAt - now > 30) {
    return cachedJwt.token;
  }

  const exp = now + 19 * 60; // 19 minutes
  const header = { alg: "ES256", kid: creds.keyId, typ: "JWT" };
  const payload = {
    iss: creds.issuerId,
    iat: now,
    exp,
    aud: "appstoreconnect-v1",
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyObject = loadPrivateKey(creds.privateKeyPem);
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: keyObject,
    dsaEncoding: "ieee-p1363", // JOSE/JWT format: raw R||S, NOT DER
  });
  const signatureB64 = base64UrlEncode(signature);
  const token = `${signingInput}.${signatureB64}`;

  cachedJwt = { token, expiresAt: exp, kid: creds.keyId };
  return token;
}

/**
 * Normalizes a private key pasted in any of the forms we've seen come out of
 * Vercel, GitHub Actions, Doppler, and shell scripts.  Handles:
 *   - real newlines (the happy path)
 *   - escaped `\n` sequences
 *   - base64 of the entire .p8 file
 *   - leading UTF-8 BOM
 *   - surrounding single or double quotes
 *   - CRLF line endings
 *   - smart-dashes / em-dashes substituted for `-----` by rich text editors
 *   - one-line PEMs that need their base64 body re-wrapped at 64 chars
 *
 * Anything not covered here is passed through and OpenSSL gets a chance at it,
 * with the loadPrivateKey error handler giving a targeted hint.
 */
export function normalizePrivateKeyPem(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw;

  // Strip UTF-8 BOM if present (some editors add one on save).
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  s = s.trim();
  if (!s) return undefined;

  // Strip surrounding quotes that someone pasted by accident.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // Convert escaped \n → real newlines (common when an env was set via
  // a shell command without quoting, or via a JSON-in-secret pipeline).
  if (!s.includes("\n") && s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }

  // Normalize CRLF → LF.
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Replace en-dash / em-dash / horizontal bar with hyphen-minus, in case a
  // rich text editor (Apple Mail, Notion, Google Docs) substituted the run of
  // `-----` with a single fancy character.
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");

  // If we still don't see a BEGIN line, try treating the whole blob as base64
  // of the .p8 file (the fully escape-proof option some pipelines prefer).
  if (!s.includes("-----BEGIN")) {
    try {
      const decoded = Buffer.from(s, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) {
        s = decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      }
    } catch {
      /* fall through — let the loader surface a real error */
    }
  }

  // If we have BEGIN/END but the whole thing is on one line (newlines lost
  // somewhere in the secret pipeline), re-wrap the base64 body at 64 chars
  // so OpenSSL can parse it.
  if (s.includes("-----BEGIN") && !s.includes("\n")) {
    const m = s.match(/^(-----BEGIN [A-Z0-9 ]+-----)\s*([A-Za-z0-9+/=\s]+?)\s*(-----END [A-Z0-9 ]+-----)\s*$/);
    if (m) {
      const [, begin, bodyRaw, end] = m;
      const body = bodyRaw.replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
      s = `${begin}\n${wrapped}\n${end}`;
    }
  }

  return s;
}

export function loadCredentialsFromEnv(): AppStoreCredentials | null {
  const keyId = process.env.APPSTORE_KEY_ID;
  const issuerId = process.env.APPSTORE_ISSUER_ID;
  const privateKeyPem = normalizePrivateKeyPem(
    process.env.APPSTORE_PRIVATE_KEY || process.env.APPSTORE_PRIVATE_KEY_BASE64,
  );
  if (!keyId || !issuerId || !privateKeyPem) return null;
  return { keyId, issuerId, privateKeyPem };
}
