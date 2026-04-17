// Shared timezone helpers — plain module (no "use client" / "server-only").
// Safe to import from both server components and client components.
//
// All display is in Europe/Berlin. MESZ (CEST, UTC+2) in summer,
// MEZ (CET, UTC+1) in winter. Labels are computed per-date so DST transitions
// (last Sunday of March and last Sunday of October) flip automatically.

export const BERLIN_TZ = "Europe/Berlin";

export function berlinOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
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

export function berlinTzLabel(date: Date): "MESZ" | "MEZ" {
  return berlinOffsetMinutes(date) >= 120 ? "MESZ" : "MEZ";
}

export function formatBerlinDateTime(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
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

export function formatBerlinTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
