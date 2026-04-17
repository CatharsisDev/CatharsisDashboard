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
  const keyObject = createPrivateKey({ key: pem, format: "pem" });
  cachedKey = { pem, keyObject };
  return keyObject;
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

/** Normalizes a private key pasted in a variety of forms. */
export function normalizePrivateKeyPem(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Case 1: already-valid PEM with real newlines
  if (trimmed.includes("-----BEGIN") && trimmed.includes("\n")) return trimmed;
  // Case 2: PEM with escaped "\n" sequences (common in Vercel env vars)
  if (trimmed.includes("-----BEGIN") && trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  // Case 3: base64 of the whole .p8 file
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded;
  } catch {
    /* fallthrough */
  }
  return trimmed;
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
