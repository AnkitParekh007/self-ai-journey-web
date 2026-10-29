import { sha1 } from './sha1';

/** Deterministic ID from stable parts: same input → same ID on every run (idempotent imports). */
export function stableId(prefix: string, ...parts: Array<string | number | undefined | null>): string {
  const key = parts.map((p) => String(p ?? '').trim().toLowerCase()).join('␟');
  return `${prefix}-${sha1(key).slice(0, 12)}`;
}

/** Time-ordered random ID for records created interactively (two devices never collide). */
export function newId(prefix: string, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = Array.from(cryptoRandom(5), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  return `${prefix}-${ts}-${rand}`;
}

function cryptoRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function slugify(s: string, max = 48): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}
