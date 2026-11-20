import { esc } from './dom';

/** The phone's idle screen. */
export function lookAtTv(title = 'Look at the TV!', sub = ''): string {
  return `<div class="screen center"><div class="tv-icon" aria-hidden="true"><span></span></div><h1 class="big">${esc(title)}</h1>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>`;
}

/**
 * Escape `text` and wrap every occurrence of each clue in a numbered <mark>.
 * Works on the raw text so overlapping clues can't break the HTML.
 */
export function markClues(text: string | undefined, clues: Array<{ text: string }> | null): string {
  if (!text) return '';
  const ranges: Array<[number, number, number]> = [];
  (clues ?? []).forEach((c, n) => {
    if (!c.text) return;
    let from = 0;
    for (;;) {
      const i = text.indexOf(c.text, from);
      if (i < 0) break;
      const j = i + c.text.length;
      if (!ranges.some(([a, b]) => i < b && j > a)) ranges.push([i, j, n + 1]);
      from = j;
    }
  });
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [a, b, n] of ranges) {
    out += esc(text.slice(at, a)) + `<mark class="clue" data-n="${n}">${esc(text.slice(a, b))}</mark>`;
    at = b;
  }
  out += esc(text.slice(at));
  return out.replace(/\n/g, '<br>');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
