const fmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
});

export function jst(isoString: string): string {
  if (!isoString) return "";
  return fmt.format(new Date(isoString));
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
