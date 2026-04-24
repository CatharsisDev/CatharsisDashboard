# Catharsis Dashboard

Private analytics and content calendar for Catharsis. Two surfaces share one design:

- `/` — **Social** · Upload-Post analytics, schedule calendar, recent uploads.
- `/app` — **App** · App Store Connect + Google Play Console analytics (ratings, reviews, installs, performance). Switch between iOS and Android with the platform toggle in the page header, or deep-link with `?platform=ios` / `?platform=android`.

All times in Europe/Berlin with MESZ/MEZ suffix. Both providers implement the shared `AnalyticsProvider` contract in `src/lib/analytics/types.ts`.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Create `.env.local` (it's git-ignored) with the vars for each integration you use. Add the same ones to Vercel → Project → Settings → Environment Variables for production.

### Upload-Post (social analytics — `/`)

| Variable | Required | Notes |
|---|---|---|
| `UPLOAD_POST_API_KEY` | yes | Used as `Authorization: Apikey ...`. |
| `UPLOAD_POST_PROFILE_USERNAME` | no | Defaults to `catharsis`. |
| `UPLOAD_POST_API_BASE` | no | Override for staging; defaults to `https://api.upload-post.com/api`. |
| `UPLOAD_POST_CALENDAR_TITLE` | no | Defaults to `Catharsis Content Calendar`. |
| `UPLOAD_POST_CALENDAR_LOGO` | no | Image URL for the read-only calendar branding. |

### App Store Connect (mobile analytics — `/app`)

Create an API key in App Store Connect → Users & Access → Keys. Choose the **Admin** or **Developer** role so the key can read reviews and performance data. Download the `.p8` file — **you can only download it once**.

| Variable | Required | Notes |
|---|---|---|
| `APPSTORE_KEY_ID` | yes | The Key ID column in the Keys list (e.g. `ABC123XYZ9`). |
| `APPSTORE_ISSUER_ID` | yes | The Issuer ID at the top of the Keys page — one per team. |
| `APPSTORE_PRIVATE_KEY` | yes | Full contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines. See paste formats below. |
| `APPSTORE_PRIVATE_KEY_BASE64` | alt | Alternative to `APPSTORE_PRIVATE_KEY`: base64 of the entire `.p8` file. Use this when your secret store strips newlines. |
| `APPSTORE_APP_ID` | no | Numeric Apple ID for a specific app. If omitted, the first app the key can see is used. |
| `APPSTORE_VENDOR_NUMBER` | no | Vendor Number from Payments and Financial Reports. Required for daily install counts via the Sales & Trends API. |

**How to paste the `.p8`:**

1. **Locally (`.env.local`)** — paste the contents verbatim inside double quotes. Bash preserves newlines inside double-quoted values:

   ```dotenv
   APPSTORE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
   MIGTAgEAMBMGByqGSM49AgEGCCqGSM49Aw...
   ...
   -----END PRIVATE KEY-----"
   ```

2. **Vercel** — two safe options:
   - Paste the PEM directly into the value field (Vercel preserves newlines).
   - Or, base64-encode the file (`base64 -i AuthKey_ABC.p8 | pbcopy` on macOS) and put the result in `APPSTORE_PRIVATE_KEY_BASE64`. The app accepts either.

The loader in `src/lib/analytics/appstore/jwt.ts` normalizes all three forms: real newlines, `\n` escape sequences, and full-file base64.

### Finding your vendor number

Sign in to App Store Connect → Payments and Financial Reports → the vendor number is shown at the top of the page (8 digits). Alternatively: Sales and Trends → top-right filter chip shows it.

### Google Play Console (Android analytics — `/app?platform=android`)

Android analytics come from the **Google Play Android Developer API v3** (reviews, IAP catalog, subscriptions) and the **Google Play Developer Reporting API v1beta1** (crashes, ANRs, error counts, slow-start / slow-rendering / wakelock rates). Authentication is a Google Cloud service-account JWT exchanged for an OAuth2 access token — no OAuth consent screen, fully server-to-server.

| Variable | Required | Notes |
|---|---|---|
| `GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64` | yes | `base64 -i catharsis-play-xxxxxxx.json | pbcopy`. Safer than the raw JSON variant because `\n` escaping in private keys is a nightmare. |
| `GOOGLEPLAY_SERVICE_ACCOUNT_JSON` | alt | Raw JSON blob. The loader accepts either form but treats base64 as the preferred path. |
| `GOOGLEPLAY_PACKAGE_NAME` | yes | The app's Android package name, e.g. `com.catharsis.cards`. |

**Setup steps:**

1. **Create a service account.** Google Cloud Console → *IAM & Admin* → *Service accounts* → Create. Open its *Keys* tab → *Add Key* → JSON. A file like `catharsis-play-xxxxxxx.json` downloads — store it safely.
2. **Enable the APIs.** Google Cloud Console → *APIs & Services* → *Library*. Enable both:
   - *Google Play Android Developer API* (reviews + catalog)
   - *Google Play Developer Reporting API* (vitals)
3. **Grant Play Console access.** Google Play Console → *Users and permissions* → *Invite new user*. Paste the service account's `client_email` (ends in `.gserviceaccount.com`) and grant **app access** with at least *View app information*, *View financial data*, and *Reply to reviews*. Account-level permissions alone are not enough — the service account needs explicit per-app access.
4. **Set env vars.** Locally: `GOOGLEPLAY_SERVICE_ACCOUNT_JSON_BASE64` and `GOOGLEPLAY_PACKAGE_NAME` in `.env.local`. On Vercel: the same two in Project → Settings → Environment Variables.
5. **Reload.** Hit `/app?platform=android` (or click the Google Play pill in the toggle). Reviews and vitals appear immediately; install counts, revenue, territories, traffic sources, funnel and retention are **not** in either Play API — they come from the Play Console *Statistics* CSV export in Google Cloud Storage, which this integration deliberately skips. A warning is shown on the page.

**A few Play-specific gotchas worth knowing:**

- Play Developer's reviews endpoint only returns reviews from the last 7 days. The dashboard samples what it can get (up to 500 reviews) and flags the window.
- The Reporting API suppresses metric sets for apps below its privacy threshold (~1k daily active installs). Freshly published or low-traffic apps will see an empty *Performance & stability* panel until Google publishes aggregates. This is the API's behaviour, not a bug.
- Crash-free user rate is reported as `1 - userPerceivedCrashRate`, averaged over 28 days. iOS reports this directly; Google only reports the rate, so the derivation is flagged inline on the panel.

## Architecture notes

- `src/lib/analytics/types.ts` — provider-agnostic contracts (`AnalyticsProvider`, `AppSnapshot`, etc.).
- `src/lib/analytics/appstore/` — App Store Connect implementation (JWT, REST client, reviews, performance, sales).
- `src/lib/analytics/googleplay/` — Google Play implementation (service-account JWT, Publisher + Reporting clients, reviews, monetization, vitals).
- `src/lib/analytics/index.ts` — provider registry. Both iOS and Android are wired up; the `/app` page picks one based on `?platform=`.
- `src/lib/tz.ts` — shared Europe/Berlin formatting + MESZ/MEZ label. Safe to import from both server and client components.
- `src/app/_components/top-nav.tsx` — shared top nav (Social / App).
- `src/app/app/platform-toggle.tsx` — iOS / Android pill switcher. Preserves other query params on switch.

## Deploy

Push to main; Vercel auto-builds. Make sure the env vars above are set in the Vercel project settings for the environments you care about (Production, Preview, Development).
