# Catharsis Dashboard

Private analytics and content calendar for Catharsis. Two surfaces share one design:

- `/` — **Social** · Upload-Post analytics, schedule calendar, recent uploads.
- `/app` — **App** · App Store Connect analytics (ratings, reviews, installs, performance).

All times in Europe/Berlin with MESZ/MEZ suffix. Google Play Console can slot in later by implementing the `AnalyticsProvider` contract in `src/lib/analytics/types.ts`.

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

## Architecture notes

- `src/lib/analytics/types.ts` — provider-agnostic contracts (`AnalyticsProvider`, `AppSnapshot`, etc.).
- `src/lib/analytics/appstore/` — App Store Connect implementation (JWT, REST client, reviews, performance, sales).
- `src/lib/analytics/index.ts` — provider registry. Add Google Play by implementing the same interface and registering it here.
- `src/lib/tz.ts` — shared Europe/Berlin formatting + MESZ/MEZ label. Safe to import from both server and client components.
- `src/app/_components/top-nav.tsx` — shared top nav (Social / App).

## Deploy

Push to main; Vercel auto-builds. Make sure the env vars above are set in the Vercel project settings for the environments you care about (Production, Preview, Development).
