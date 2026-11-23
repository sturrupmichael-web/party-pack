/** The Swatch Watch colour grid: 32 hues across, 18 shades down (light at the top). 576 colours. */
export const COLS = 32;
export const ROWS = 18;
export const ROW_LABELS = 'ABCDEFGHJKLMNPQRST'; // no I or O, so they can't be mistaken for 1 and 0

export function cellColor(r: number, c: number): string {
  const h = Math.round((c * 360) / COLS);
  const l = Math.round(88 - (r * 62) / (ROWS - 1));
  const s = 62 + Math.round(30 * Math.sin((Math.PI * (r + 1)) / (ROWS + 1)));
  return `hsl(${h} ${s}% ${l}%)`;
}

export function cellName(i: number): string {
  return `${ROW_LABELS[Math.floor(i / COLS)]}${(i % COLS) + 1}`;
}

export const rc = (i: number): [number, number] => [Math.floor(i / COLS), i % COLS];
export const idx = (r: number, c: number) => r * COLS + c;

/** Chebyshev distance between cells (how many rings apart). */
export function ring(a: number, b: number): number {
  const [r1, c1] = rc(a);
  const [r2, c2] = rc(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

/** The whole grid as an HTML table-free div grid. `marks` puts content in cells. */
export function gridHtml(o: { cls?: string; marks?: Record<number, string>; frame?: number | null; target?: number | null; labels?: boolean }): string {
  let cells = '';
  for (let i = 0; i < ROWS * COLS; i++) {
    const [r, c] = rc(i);
    const inFrame = o.frame != null && ring(i, o.frame) <= 1;
    cells += `<i data-i="${i}" class="${inFrame ? 'fr' : ''}${o.target === i ? ' tg' : ''}" style="background:${cellColor(r, c)}">${o.marks?.[i] ?? ''}</i>`;
  }
  const top = o.labels ? `<div class="sw-cols">${Array.from({ length: COLS }, (_, c) => `<span>${c + 1}</span>`).join('')}</div>` : '';
  const side = o.labels ? `<div class="sw-rows">${[...ROW_LABELS].map((l) => `<span>${l}</span>`).join('')}</div>` : '';
  return `<div class="sw ${o.cls ?? ''}">${top}<div class="sw-body">${side}<div class="sw-grid">${cells}</div></div></div>`;
}
