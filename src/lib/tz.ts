// Shared timezone helpers — plain module (no "use client" / "server-only").
// Safe to import from both server components and client components.
//
// All display is in Europe/Berlin. MESZ (CEST, UTC+2) in summer,
// MEZ (CET, UTC+1) in winter. Labels are computed per-date so DST transitions
// (last Sunday of March and last Sunday of October) flip automatically.

export const BERLIN_TZ = "Europe/Berlin";

/**
 * Minutes offset between the given zone's wall-clock and UTC, at the given instant.
 * Positive means the zone is ahead of UTC.  E.g. Europe/Berlin returns 120 in summer,
 * 60 in winter.  New_York returns -240/-300.
 */
export function getTzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour) === 24 ? 0 : Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

export function berlinOffsetMinutes(date: Date): number {
  return getTzOffsetMinutes(date, BERLIN_TZ);
}

export function berlinTzLabel(date: Date): "MESZ" | "MEZ" {
  return berlinOffsetMinutes(date) >= 120 ? "MESZ" : "MEZ";
}

/**
 * Convert a "wall-clock" timestamp (YYYY-MM-DDTHH:mm[:ss][.fff]) to a real Date,
 * interpreting it as local time in the given zone.
 *
 * Uses one round-trip of `getTzOffsetMinutes` to get the right offset for that moment,
 * which handles DST correctly except in the narrow "spring-forward gap" hour
 * (which is unphysical anyway — the API shouldn't produce such a time).
 */
export function zonedWallClockToUtc(wallClock: string, tz: string): Date {
  const m = wallClock.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/,
  );
  if (!m) return new Date(wallClock);
  const [, Y, Mo, D, H, Mi, S] = m;
  // First guess: treat the wall-clock as if it were UTC.
  const naiveUtc = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, S ? Math.floor(Number(S)) : 0);
  // Get the zone's offset at that moment, then shift.
  const offset = getTzOffsetMinutes(new Date(naiveUtc), tz);
  return new Date(naiveUtc - offset * 60_000);
}

/**
 * Does the ISO-ish string carry explicit timezone info ('Z' or '±HH:MM')?
 * When true, `new Date(s)` gives the right instant.
 * When false, the string is naive and needs a zone attached somehow.
 */
export function hasExplicitTimezone(value: string): boolean {
  return /Z$/.test(value) || /[+-]\d{2}:?\d{2}$/.test(value);
}

function formatBerlinFromDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} · ${time} ${berlinTzLabel(d)}`;
}

/** Public helper used for already-absolute timestamps (upload_timestamp, etc.). */
export function formatBerlinDateTime(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return formatBerlinFromDate(d);
}

export function formatBerlinTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Canonical resolver for an Upload-Post scheduled-post timestamp.
 * Prefers the authoritative `original_scheduled_str` + `original_timezone`
 * (what the user actually typed when scheduling).  Falls back to `scheduled_date`,
 * assuming UTC when it is naive.
 */
export interface ScheduledInstantInput {
  scheduled_date?: string;
  original_scheduled_str?: string;
  original_timezone?: string;
}

export function resolveScheduledInstant(input: ScheduledInstantInput): Date | null {
  if (input.original_scheduled_str && input.original_timezone) {
    return zonedWallClockToUtc(input.original_scheduled_str, input.original_timezone);
  }
  const raw = input.scheduled_date;
  if (!raw) return null;
  if (hasExplicitTimezone(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Naive string — interpret as UTC (Node/V8 behaviour for strict ISO).
  const d = new Date(`${raw}${raw.endsWith("Z") ? "" : "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format an Upload-Post scheduled post instant in Europe/Berlin with MESZ/MEZ. */
export function formatScheduledBerlin(input: ScheduledInstantInput): string {
  const d = resolveScheduledInstant(input);
  return d ? formatBerlinFromDate(d) : "—";
}

/** Same but time only ("15:30"). */
export function formatScheduledBerlinTime(input: ScheduledInstantInput): string {
  const d = resolveScheduledInstant(input);
  return d ? formatBerlinTime(d) : "—";
}
