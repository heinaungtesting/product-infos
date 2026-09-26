const TZ = "Asia/Tokyo";
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const longDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** "Mon, Sep 28, 12:00" in JST. */
export function jst(isoString: string): string {
  if (!isoString) return "";
  return fmt.format(new Date(isoString));
}

/** "Sep 28" in JST. */
export function day(isoString: string): string {
  return isoString ? dayFmt.format(new Date(isoString)) : "";
}

/** "Sat, Sep 26" in JST. */
export function longDay(isoString: string | number = Date.now()): string {
  return longDayFmt.format(new Date(isoString));
}

/** "Sep 28 · 12:00 (Mon)" in JST. */
export function slot(isoString: string): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  return `${dayFmt.format(d)} · ${timeFmt.format(d)} (${wdFmt.format(d)})`;
}

/** Whole JST calendar days from `now` to `isoString` (negative = past). */
export function daysUntil(isoString: string, now: string | number = Date.now()): number {
  const a = Date.parse(keyFmt.format(new Date(now)));
  const b = Date.parse(keyFmt.format(new Date(isoString)));
  return Math.round((b - a) / 86_400_000);
}

/** "overdue", "due today", "due tomorrow", "due in 3 days", "due Oct 12". */
export function dueLabel(isoString: string, now: string | number = Date.now(), overdue = false): string {
  if (!isoString) return "";
  if (overdue) return "overdue";
  const n = daysUntil(isoString, now);
  if (n <= 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n < 7) return `due in ${n} days`;
  return `due ${day(isoString)}`;
}

export function countdown(isoString: string, now = Date.now()): string {
  const ms = new Date(isoString).getTime() - now;
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** "shop-offline-sync" → "Shop offline sync". */
export function humanize(id: string): string {
  const s = id.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
