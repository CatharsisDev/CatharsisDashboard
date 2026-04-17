import { createAppStoreJWT, loadCredentialsFromEnv } from "./jwt";

const API_BASE = "https://api.appstoreconnect.apple.com";

export class AppStoreApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`App Store Connect API ${status}: ${body.slice(0, 300)}`);
    this.name = "AppStoreApiError";
    this.status = status;
    this.body = body;
  }
}

export function ascAuthHeader(): string {
  const creds = loadCredentialsFromEnv();
  if (!creds) throw new Error("App Store Connect credentials are not configured");
  return `Bearer ${createAppStoreJWT(creds)}`;
}

export interface AscFetchOptions {
  method?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  acceptGzip?: boolean;
  /** When true, return the raw Response; useful for binary downloads (sales reports). */
  raw?: boolean;
}

function buildUrl(path: string, query?: AscFetchOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function ascFetchJson<T>(path: string, options: AscFetchOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: ascAuthHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new AppStoreApiError(res.status, await res.text().catch(() => ""));
  }
  return (await res.json()) as T;
}

export async function ascFetchRaw(path: string, options: AscFetchOptions = {}): Promise<Response> {
  const url = buildUrl(path, options.query);
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: ascAuthHeader(),
      Accept: options.acceptGzip ? "application/a-gzip" : "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new AppStoreApiError(res.status, await res.text().catch(() => ""));
  }
  return res;
}

/** Walk paginated ASC responses (links.next) up to maxPages. */
export async function ascFetchAll<T>(
  path: string,
  options: AscFetchOptions & { maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? 5;
  let nextUrl: string | null = buildUrl(path, options.query);
  const acc: T[] = [];
  let pages = 0;
  while (nextUrl && pages < maxPages) {
    const res: { data?: T[]; links?: { next?: string } } = await ascFetchJson(nextUrl);
    if (Array.isArray(res?.data)) acc.push(...res.data);
    nextUrl = res?.links?.next ?? null;
    pages += 1;
  }
  return acc;
}
