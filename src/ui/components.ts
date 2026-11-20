/**
 * Shared phone components: text input, pick list, yes/no, and the dial.
 * Each one renders into the element it's given and owns that DOM, so the
 * shell can re-render around it without wiping what the player is doing.
 */
import { esc } from './dom';

export interface TextFormOpts {
  title: string;
  /** Extra HTML above the input (e.g. the secret word). */
  above?: string;
  placeholder?: string;
  max?: number;
  /** Keep only the first word, and block spaces as you type. */
  oneWord?: boolean;
  button?: string;
  /** Optional second, quieter action (e.g. "Pass"). */
  alt?: { label: string; onClick(): void };
  draft?: { get(): string; set(v: string): void };
  onSubmit(text: string): void;
}

export function textForm(el: HTMLElement, o: TextFormOpts): void {
  el.innerHTML = `<form class="screen tform">
    <p class="kicker">${esc(o.title)}</p>
    ${o.above ?? ''}
    <input class="tin" maxlength="${o.max ?? 40}" placeholder="${esc(o.placeholder ?? '')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
    <button class="btn primary huge" type="submit">${esc(o.button ?? 'Send')}</button>
    ${o.alt ? `<button class="link" type="button" data-alt>${esc(o.alt.label)}</button>` : ''}
  </form>`;
  const form = el.querySelector('form')!;
  const input = el.querySelector<HTMLInputElement>('.tin')!;
  input.value = o.draft?.get() ?? '';
  input.addEventListener('input', () => {
    if (o.oneWord) input.value = input.value.replace(/\s+/g, '');
    o.draft?.set(input.value);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let v = input.value.trim();
    if (o.oneWord) v = v.split(/\s+/)[0] ?? '';
    if (!v) return input.focus();
    input.blur();
    o.onSubmit(v);
  });
  el.querySelector('[data-alt]')?.addEventListener('click', () => o.alt!.onClick());
}

export interface PickItem {
  id: string;
  label: string;
  /** Optional HTML before the label (an avatar, an icon). */
  icon?: string;
  disabled?: boolean;
}

/** A grid of big buttons that always fits the screen (no scrolling). */
export function pickList(el: HTMLElement, o: { title: string; sub?: string; items: PickItem[]; cols?: number; back?: () => void; onPick(id: string): void }): void {
  const cols = o.cols ?? (o.items.length > 8 ? 2 : 1);
  el.innerHTML = `<div class="screen plist">
    <p class="kicker">${esc(o.title)}</p>${o.sub ? `<p class="muted sub">${esc(o.sub)}</p>` : ''}
    <div class="pgrid" style="--cols:${cols};--rows:${Math.ceil(o.items.length / cols)}">${o.items
      .map((it) => `<button class="pbtn" data-id="${esc(it.id)}" ${it.disabled ? 'disabled' : ''}>${it.icon ?? ''}<span>${esc(it.label)}</span></button>`)
      .join('')}</div>
    ${o.back ? '<button class="link" data-back>Back</button>' : ''}
  </div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => o.onPick(b.dataset.id!)));
  el.querySelector('[data-back]')?.addEventListener('click', () => o.back!());
}

export function yesNo(el: HTMLElement, o: { title: string; yes: string; no: string; onPick(yes: boolean): void }): void {
  el.innerHTML = `<div class="screen two-choice">
    <p class="prompt">${esc(o.title)}</p>
    <button class="choice good" data-yes="1"><span>${esc(o.yes)}</span></button>
    <button class="choice bad" data-yes="0"><span>${esc(o.no)}</span></button>
  </div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-yes]').forEach((b) => b.addEventListener('click', () => o.onPick(b.dataset.yes === '1')));
}

/** Sent screen: one line and the TV icon. */
export function sentScreen(title: string, sub = 'Look at the TV!'): string {
  return `<div class="screen center"><div class="sent-check">✓</div><h1 class="big">${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>`;
}

// ---- Dial ------------------------------------------------------------------------
// A half circle: value 0 is far left, 100 far right.
const CX = 150;
const CY = 150;
const R = 130;

function polar(v: number, r = R): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(v0: number, v1: number, r = R): string {
  const [x0, y0] = polar(Math.max(0, v0), r);
  const [x1, y1] = polar(Math.min(100, v1), r);
  return `M${CX},${CY} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z`;
}

/** Scoring bands around the target, as [half width, label, colour]. Kept in sync with Dial In's logic. */
export const DIAL_BANDS: Array<[number, string, string]> = [
  [12, '2', '#4cc9f0'],
  [7, '3', '#ffb703'],
  [2.5, '4', '#ff4d6d'],
];

export interface DialDraw {
  left: string;
  right: string;
  /** Secret target (draw the scoring wedge). */
  target?: number | null;
  needles?: Array<{ v: number; color: string; label?: string }>;
  /** Hide the face with a "screen" (for guessers). */
  shut?: boolean;
}

/** The dial as an SVG string (TV and phone). */
export function dialSvg(d: DialDraw): string {
  let wedge = '';
  if (d.target != null) {
    wedge = DIAL_BANDS.map(([w, , c]) => `<path d="${arc(d.target! - w, d.target! + w)}" fill="${c}"/>`).join('');
  }
  const needles = (d.needles ?? [])
    .map((n) => {
      const [x, y] = polar(n.v, R - 6);
      return `<line x1="${CX}" y1="${CY}" x2="${x}" y2="${y}" stroke="${n.color}" stroke-width="6" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="9" fill="${n.color}" stroke="#120c2c" stroke-width="3"/>`;
    })
    .join('');
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const [x0, y0] = polar(i * 10, R);
    const [x1, y1] = polar(i * 10, R - 10);
    return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#3a2e7a" stroke-width="3"/>`;
  }).join('');
  return `<svg class="dial" viewBox="0 0 300 168">
    <path d="${arc(0, 100)}" fill="#fdf6e3"/>
    ${wedge}${ticks}
    ${d.shut ? `<path d="${arc(0, 100, R + 2)}" fill="#3a2e7a"/>` : ''}
    ${needles}
    <circle cx="${CX}" cy="${CY}" r="14" fill="#120c2c"/>
  </svg>`;
}

/** An interactive phone dial: drag anywhere on it to aim the needle. */
export function mountDial(host: HTMLElement, o: { left: string; right: string; value: number; color: string; target?: number | null; onChange(v: number): void }): { get(): number } {
  let v = o.value;
  const draw = () => {
    host.innerHTML = `<div class="dial-wrap">${dialSvg({ left: o.left, right: o.right, target: o.target, needles: [{ v, color: o.color }] })}<div class="dial-ends"><span>${esc(o.left)}</span><span>${esc(o.right)}</span></div></div>`;
  };
  draw();
  const set = (e: PointerEvent) => {
    const svg = host.querySelector('svg')!;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 300 - CX;
    const y = CY - ((e.clientY - r.top) / r.height) * 168;
    const a = Math.atan2(Math.max(0, y), x);
    v = Math.round(Math.min(100, Math.max(0, 100 * (1 - a / Math.PI))));
    draw();
    o.onChange(v);
  };
  host.style.touchAction = 'none';
  host.addEventListener('pointerdown', (e) => {
    host.setPointerCapture(e.pointerId);
    set(e);
  });
  host.addEventListener('pointermove', (e) => {
    if (host.hasPointerCapture(e.pointerId)) set(e);
  });
  return { get: () => v };
}

/** "4:05" for long timers, "45" for short ones. */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s >= 100 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
}
