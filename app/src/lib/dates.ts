export const todayIso = () => new Date().toISOString().slice(0, 10);

export function localDay(timeZone: string, d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p; // YYYY-MM-DD
}

export function relDays(day: string | null | undefined, today: string): string {
  if (!day) return '';
  const n = Math.round((Date.parse(day.slice(0, 10)) - Date.parse(today)) / 86_400_000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
