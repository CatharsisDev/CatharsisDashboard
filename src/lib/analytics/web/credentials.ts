// Web (GA4) configuration. Auth piggy-backs on the gcloud user-OAuth refresh
// token already configured for Google Play (GOOGLEPLAY_USER_OAUTH_JSON{,_BASE64}).
// The only Web-specific env vars are the property ID + the hostname we
// display in the UI header.
//
// IMPORTANT: the existing refresh token must have been minted with the
// `analytics.readonly` scope. The default `gcloud auth application-default
// login` doesn't include it — re-run with:
//   gcloud auth application-default login \
//     --scopes=openid,\
// https://www.googleapis.com/auth/userinfo.email,\
// https://www.googleapis.com/auth/cloud-platform,\
// https://www.googleapis.com/auth/devstorage.read_only,\
// https://www.googleapis.com/auth/analytics.readonly
// then re-paste the file at ~/.config/gcloud/application_default_credentials.json
// into GOOGLEPLAY_USER_OAUTH_JSON_BASE64.

export interface WebAnalyticsConfig {
  propertyId: string;    // numeric GA4 property ID (e.g. "123456789")
  hostname: string;      // display label in the UI header (e.g. catharsis.cards)
}

export function loadWebConfigFromEnv(): WebAnalyticsConfig | null {
  const raw = (process.env.GA4_PROPERTY_ID || "").trim();
  if (!raw) return null;
  // Accept "properties/123" or "123"; strip the prefix so the API call can
  // re-add it cleanly. People copy-paste from GA4 → Admin in both forms.
  const propertyId = raw.replace(/^properties\//, "");
  if (!/^\d+$/.test(propertyId)) {
    throw new Error(
      `GA4_PROPERTY_ID must be the numeric property ID (e.g. 123456789), ` +
        `not the measurement ID (G-XXXXXX). Got: ${JSON.stringify(raw)}.`,
    );
  }
  // Hostname is purely cosmetic — used as the page header label. Defaults to
  // catharsis.cards because that's the only site this dashboard tracks today.
  const hostname = (process.env.GA4_HOSTNAME || "catharsis.cards").trim();
  return { propertyId, hostname };
}

export interface WebDiagnostics {
  configured: boolean;
  missing: string[];
  present: string[];
  parseError?: string;
}

/**
 * Inspect the running environment and report what's wrong, so the setup
 * screen can show a helpful "we see X but not Y" hint instead of a generic
 * "not configured" message.
 */
export function inspectWebConfig(): WebDiagnostics {
  const present: string[] = [];
  const missing: string[] = [];

  const hasProp = !!process.env.GA4_PROPERTY_ID;
  const hasPlaySa =
    !!process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON ||
    !!process.env.GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64;
  const hasGa4Sa =
    !!process.env.GA4_SERVICE_ACCOUNT_JSON ||
    !!process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64;
  const hasUserOAuth =
    !!process.env.GOOGLEPLAY_USER_OAUTH_JSON ||
    !!process.env.GOOGLEPLAY_USER_OAUTH_JSON_BASE64;

  if (hasProp) present.push("GA4_PROPERTY_ID");
  if (process.env.GA4_HOSTNAME) present.push("GA4_HOSTNAME");
  if (hasGa4Sa) {
    present.push(
      process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64
        ? "GA4_SERVICE_ACCOUNT_JSON_BASE64 (preferred for GA4)"
        : "GA4_SERVICE_ACCOUNT_JSON (preferred for GA4)",
    );
  } else if (hasPlaySa) {
    present.push("GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64 (reused for GA4)");
  }
  if (hasUserOAuth) {
    present.push(
      process.env.GOOGLEPLAY_USER_OAUTH_JSON_BASE64
        ? "GOOGLEPLAY_USER_OAUTH_JSON_BASE64 (fallback)"
        : "GOOGLEPLAY_USER_OAUTH_JSON (fallback)",
    );
  }

  if (!hasProp) missing.push("GA4_PROPERTY_ID");
  // Either auth path is acceptable.
  if (!hasGa4Sa && !hasPlaySa && !hasUserOAuth) {
    missing.push("a service account or GOOGLEPLAY_USER_OAUTH_JSON_BASE64");
  }

  if (missing.length) {
    return { configured: false, missing, present };
  }

  try {
    const cfg = loadWebConfigFromEnv();
    if (!cfg) return { configured: false, missing, present };
    return { configured: true, missing, present };
  } catch (err) {
    return {
      configured: false,
      missing,
      present,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}
