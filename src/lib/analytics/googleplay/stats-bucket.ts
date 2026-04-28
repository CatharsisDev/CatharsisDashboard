import { gpFetchBytes, gpFetchJson, GooglePlayApiError } from "./client";

// Play Console exports its daily Statistics, Acquisition and Financial
// reports as CSV files into a Cloud Storage bucket Google creates for you.
// The bucket name is shown in Play Console → Download reports → "Copy Cloud
// Storage URI" and looks like `gs://pubsite_prod_1234567890123`.
//
// Two annoying details:
//   1. The CSVs are UTF-16 LE with a BOM. Naïve UTF-8 decoding produces
//      garbage with NULs between every character.
//   2. Each report is one file per package per *month*, so to cover the
//      last 30 days we sometimes have to read the current month + previous
//      month and stitch them together by date.
//
// The Cloud Storage JSON API (storage.googleapis.com/storage/v1) is what we
// hit — listing uses GET /b/{bucket}/o?prefix=…, downloading uses
// GET /b/{bucket}/o/{name}?alt=media. Both happen to honor the
// devstorage.read_only OAuth scope we've already requested in client.ts.

const STORAGE_BASE = "https://storage.googleapis.com";

interface ListResponse {
  items?: Array<{ name?: string; size?: string; updated?: string }>;
  nextPageToken?: string;
}

/**
 * List object names under a prefix. Paginates through all results in case
 * the bucket has many months of history.
 */
export async function listBucket(bucket: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await gpFetchJson<ListResponse>(
      `/storage/v1/b/${encodeURIComponent(bucket)}/o`,
      {
        baseUrl: STORAGE_BASE,
        query: { prefix, pageToken },
        // Prefer user-OAuth (gcloud ADC) for the bucket — see client.ts for
        // why; falls back to the service account when not configured.
        useUserAuth: true,
      },
    );
    for (const item of res.items || []) {
      if (item.name) names.push(item.name);
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return names;
}

/**
 * Download a Play Console CSV and decode it as UTF-16 LE text. Returns the
 * raw text (with BOM stripped) — the caller then runs it through
 * parseCsvRows. Returns null if the object is missing (404), so callers
 * can probe optional months without try/catching.
 */
export async function downloadCsv(bucket: string, objectName: string): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = await gpFetchBytes(`/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`, {
      baseUrl: STORAGE_BASE,
      query: { alt: "media" },
      useUserAuth: true,
    });
  } catch (err) {
    if (err instanceof GooglePlayApiError && err.status === 404) return null;
    throw err;
  }
  return decodeMaybeUtf16(bytes);
}

/**
 * Most Play Console CSVs are UTF-16 LE with a 0xFF 0xFE BOM. Some older
 * exports (and the metadata.csv files) are plain UTF-8. We sniff the BOM
 * and pick the right decoder.
 */
function decodeMaybeUtf16(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16 LE
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE — rare but technically allowed
    return new TextDecoder("utf-16be").decode(buf.subarray(2));
  }
  // Strip a UTF-8 BOM if present.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  return buf.toString("utf8");
}

/**
 * Minimal CSV parser tailored to Play Console exports — handles quoted
 * fields, escaped quotes (""), and CRLF/LF line endings. Returns an array
 * of rows where each row is an object keyed by header name. Skips fully
 * empty rows.
 */
export function parseCsvRows(csv: string): Record<string, string>[] {
  const lines = splitCsvLines(csv);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    out.push(row);
  }
  return out;
}

/**
 * Split CSV text into lines, respecting quoted fields that may contain
 * literal newlines (rare in Play Console output but we handle it anyway).
 */
function splitCsvLines(csv: string): string[] {
  const lines: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      cur += c;
      // Toggle quote state, accounting for "" escape sequences which stay
      // inside the same field. parseCsvLine handles the actual unescape.
      if (csv[i + 1] === '"' && inQuote) {
        cur += '"';
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (c === "\n" || c === "\r")) {
      // Collapse \r\n into a single break.
      if (c === "\r" && csv[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuote = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') {
      inQuote = true;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Build the list of YYYYMM strings covering the last `daysBack` days, in
 * descending order (newest first). Used to figure out which monthly CSVs
 * to fetch.
 */
export function monthsSpanning(daysBack: number, now = new Date()): string[] {
  const out = new Set<string>();
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.add(`${y}${m}`);
  }
  return Array.from(out).sort().reverse();
}
