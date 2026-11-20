/**
 * Compact drawing format. A drawing is a list of strokes; each stroke is a
 * string: one char colour index, one char width index, then each point as
 * two base-36 chars for x (0–999) and two for y (0–749). A full drawing is a
 * few KB, small enough to broadcast.
 */
export const W = 1000;
export const H = 750;
export const INK = ['#1b1b1f', '#e63946', '#1d70d6', '#2a9d4b', '#f4a020', '#8a5a2b', '#9b5de5', '#ffffff'];
export const WIDTHS = [8, 18, 40];
export const MAX_POINTS = 1500;

export type Pt = [number, number];
export interface Stroke {
  c: number;
  w: number;
  p: Pt[];
}

const b36 = (n: number) => Math.max(0, Math.min(1295, Math.round(n))).toString(36).padStart(2, '0');

export function encodeStroke(s: Stroke): string {
  return `${s.c}${s.w}${s.p.map(([x, y]) => b36(x) + b36(y)).join('')}`;
}

export function decodeStroke(s: string): Stroke | null {
  const c = Number(s[0]);
  const w = Number(s[1]);
  if (!(c >= 0 && c < INK.length && w >= 0 && w < WIDTHS.length)) return null;
  const p: Pt[] = [];
  for (let i = 2; i + 4 <= s.length; i += 4) {
    const x = parseInt(s.slice(i, i + 2), 36);
    const y = parseInt(s.slice(i + 2, i + 4), 36);
    if (Number.isFinite(x) && Number.isFinite(y)) p.push([Math.min(W, x), Math.min(H, y)]);
  }
  return p.length ? { c, w, p } : null;
}

/** Keep a drawing within limits, whatever a phone sends. */
export function sanitize(d: unknown): string[] {
  if (!Array.isArray(d)) return [];
  const out: string[] = [];
  let pts = 0;
  for (const s of d.slice(0, 400)) {
    if (typeof s !== 'string' || !/^[0-7][0-2][0-9a-z]*$/.test(s)) continue;
    const n = Math.floor((s.length - 2) / 4);
    if (n < 1) continue;
    if (pts + n > MAX_POINTS) break;
    pts += n;
    out.push(s.slice(0, 2 + n * 4));
  }
  return out;
}

export function pointCount(d: string[]): number {
  return d.reduce((a, s) => a + Math.floor((s.length - 2) / 4), 0);
}

/** Render a drawing as an inline SVG (white paper). */
export function toSvg(d: string[] | null | undefined, cls = 'ink'): string {
  const paths = (d ?? [])
    .map(decodeStroke)
    .filter((s): s is Stroke => !!s)
    .map((s) => {
      const pts = s.p.length === 1 ? [s.p[0], [s.p[0][0] + 0.1, s.p[0][1]]] : s.p;
      return `<polyline points="${pts.map((q) => q.join(',')).join(' ')}" stroke="${INK[s.c]}" stroke-width="${WIDTHS[s.w]}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><rect width="${W}" height="${H}" fill="#fffdf6"/>${paths}</svg>`;
}
