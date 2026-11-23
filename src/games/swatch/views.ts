import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { sentScreen, textForm } from '../../ui/components';
import { esc } from '../../ui/dom';
import { COLS, ROWS, cellColor, cellName, gridHtml, idx, rc } from './grid';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const chip = (P: Player[], k: string | null | undefined, size = 64) => {
  const p = who(P, k);
  return p ? `<span class="pchip" style="--pc:${color(p.look)}">${avatar(p.look, size)}<b>${esc(p.name)}</b></span>` : '';
};

function markHtml(P: Player[], marks: Record<string, number[]>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, ms] of Object.entries(marks)) {
    const p = who(P, k);
    if (!p) continue;
    ms.forEach((m, n) => (out[m] = (out[m] ?? '') + `<b class="mk ${n ? 'second' : ''}" style="--pc:${color(p.look)}" title="${esc(p.name)}"></b>`));
  }
  return out;
}

function clueLine(clues: string[]): string {
  return clues.map((c, i) => `<span class="sw-clue ${i ? 'two' : ''}">“${esc(c)}”</span>`).join('<span class="muted"> then </span>');
}

let lastCount = 0;
const markCount = (pub: any) => Object.values(pub.marks as Record<string, number[]>).reduce((a, m) => a + m.length, 0);

export const swatchViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}:${c.pub.phase}`,
    mount(el, c) {
      const p = c.pub;
      const P = c.players;
      let head = '';
      if (p.phase === 'pick') {
        c.sfx.whoosh();
        head = `<div class="kicker">Round ${p.round + 1} of ${p.rounds}</div><h1 class="title-m">${chip(P, p.cuer, 72)} is picking a colour…</h1>${p.round === 0 ? '<p class="muted">They\'ll give a one-word clue, then a two-word clue. Mark the colour on your phone: dead on 300, next to it 200, two away 100.</p>' : ''}`;
      } else if (p.phase === 'guess1' || p.phase === 'guess2') {
        c.sfx.reveal();
        head = `<div class="kicker">${chip(P, p.cuer)} says · ${p.phase === 'guess1' ? 'first' : 'second'} mark</div><h1 class="title-m">${clueLine(p.clues)}</h1>`;
      } else if (p.phase === 'clue2') {
        head = `<div class="kicker">${chip(P, p.cuer)} said ${clueLine(p.clues)}</div><h1 class="title-m">Now a second clue (up to two words)…</h1>`;
      } else if (p.phase === 'reveal') {
        c.sfx.reveal();
        const rows = Object.entries(p.last as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `<span class="pick-chip right">${avatar(who(P, k)?.look ?? 0, 40)}<span class="nm">${esc(who(P, k)?.name ?? '')}${k === p.cuer ? ' 🎨' : ''}</span><b>+${n}</b></span>`)
          .join('');
        head = `<div class="sw-reveal-head"><span class="swatch-big pop" style="background:${cellColor(...rc(p.target))}"></span><div><div class="kicker">The colour was ${cellName(p.target)} · ${clueLine(p.clues)}</div><div class="picks">${rows || '<span class="muted">Nobody got close!</span>'}</div></div></div>`;
        setTimeout(() => (rows ? c.sfx.good() : c.sfx.bad()), 500);
      }
      lastCount = markCount(p);
      el.innerHTML = `<div class="sw-screen"><div class="sw-head">${head}</div>${gridHtml({ cls: 'tv', labels: true, marks: markHtml(P, p.marks), frame: p.target, target: p.target })}</div>`;
    },
    update(el, c) {
      const n = markCount(c.pub);
      if (n === lastCount) return;
      if (n > lastCount) c.sfx.lock();
      lastCount = n;
      const marks = markHtml(c.players, c.pub.marks);
      el.querySelectorAll<HTMLElement>('.sw-grid i').forEach((cell) => {
        const html = marks[Number(cell.dataset.i)] ?? '';
        if (cell.innerHTML !== html) cell.innerHTML = html;
      });
    },
  },
  phone: phoneView(),
};

function phoneView(): GameViews['phone'] {
  let sent = '';
  let chosen: number | null = null;
  let sel = idx(6, 12);
  let at = '';

  const view: GameViews['phone'] = {
    key(c) {
      const here = `${c.pub.round}:${c.pub.phase}`;
      if (here !== at) {
        at = here;
        chosen = null;
      }
      return `${here}:${sent === here}:${chosen}:${(c.priv?.marks ?? []).length}`;
    },
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const here = `${p.round}:${p.phase}`;
      const redraw = () => {
        view.key(c);
        view.mount(el, c);
      };
      if (pr.audience) return void (el.innerHTML = lookAtTv());
      if (pr.cuer) {
        if (p.phase === 'pick') {
          if (sent === here) return void (el.innerHTML = sentScreen('Clue sent'));
          if (chosen == null) {
            el.innerHTML = `<div class="screen">
              <p class="kicker">Pick your secret colour</p>
              <div class="sw-options">${(pr.options as number[]).map((i) => `<button data-o="${i}" style="background:${cellColor(...rc(i))}"><span>${cellName(i)}</span></button>`).join('')}</div>
              <p class="muted center-t">Only you can see these.</p>
            </div>`;
            el.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b) => b.addEventListener('click', () => ((chosen = Number(b.dataset.o)), redraw())));
            return;
          }
          return textForm(el, {
            title: 'One-word clue for your colour',
            above: `<div class="swatch-pick" style="background:${cellColor(...rc(chosen))}"><span>${cellName(chosen)}</span></div>`,
            placeholder: 'One word',
            oneWord: true,
            max: 24,
            button: 'Send clue',
            alt: { label: 'Pick a different colour', onClick: () => ((chosen = null), redraw()) },
            onSubmit: (text) => {
              c.send({ t: 'clue', i: chosen, text, round: p.round });
              sent = here;
              redraw();
            },
          });
        }
        const sw = pr.target != null ? `<div class="swatch-pick" style="background:${cellColor(...rc(pr.target))}"><span>${cellName(pr.target)}</span></div>` : '';
        if (p.phase === 'clue2') {
          if (sent === here) return void (el.innerHTML = sentScreen('Clue sent'));
          return textForm(el, {
            title: 'Second clue: up to two words',
            above: sw,
            placeholder: 'Up to two words',
            max: 30,
            button: 'Send clue',
            onSubmit: (text) => {
              c.send({ t: 'clue', text, round: p.round });
              sent = here;
              redraw();
            },
          });
        }
        if (p.phase === 'reveal') {
          const got = p.last?.[c.me.key] ?? 0;
          return void (el.innerHTML = got ? `<div class="screen center good-bg"><div class="result-face">🎨</div><h1 class="big">+${got}</h1><p>Nicely clued!</p></div>` : lookAtTv('Nobody found it!'));
        }
        return void (el.innerHTML = `<div class="screen center">${sw}<h1 class="big">Your colour</h1><p class="muted">Keep a straight face. Look at the TV!</p></div>`);
      }
      // Guessers.
      if (p.phase === 'guess1' || p.phase === 'guess2') {
        const need = p.phase === 'guess1' ? 1 : 2;
        const mine = (pr.marks ?? []) as number[];
        if (mine.length >= need || sent === here) return void (el.innerHTML = sentScreen('Marked'));
        const zoom: string[] = [];
        const [sr, sc] = rc(sel);
        const r0 = Math.min(ROWS - 5, Math.max(0, sr - 2));
        const c0 = Math.min(COLS - 5, Math.max(0, sc - 2));
        for (let r = r0; r < r0 + 5; r++)
          for (let cc = c0; cc < c0 + 5; cc++) {
            const i = idx(r, cc);
            zoom.push(`<button data-z="${i}" class="${i === sel ? 'on' : ''} ${mine.includes(i) ? 'mine' : ''}" style="background:${cellColor(r, cc)}"></button>`);
          }
        el.innerHTML = `<div class="screen sw-phone">
          <div class="clue-mid small">${clueLine(p.clues)}</div>
          ${gridHtml({ cls: 'mini', marks: Object.fromEntries(mine.map((m) => [m, '<b class="mk"></b>'])) })}
          <div class="sw-zoom">${zoom.join('')}</div>
          <button class="btn primary huge" data-lock ${mine.includes(sel) ? 'disabled' : ''}>${mine.includes(sel) ? `${cellName(sel)} is marked: pick another` : `Mark ${cellName(sel)}`}</button>
        </div>`;
        el.querySelector<HTMLElement>(`.sw-grid i[data-i="${sel}"]`)?.classList.add('sel');
        el.querySelectorAll<HTMLElement>('.sw-grid i').forEach((cell) => cell.addEventListener('click', () => ((sel = Number(cell.dataset.i)), view.mount(el, c))));
        el.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => b.addEventListener('click', () => ((sel = Number(b.dataset.z)), view.mount(el, c))));
        el.querySelector('[data-lock]')!.addEventListener('click', () => {
          c.send({ t: 'mark', i: sel, round: p.round });
          sent = here;
          redraw();
        });
        return;
      }
      if (p.phase === 'reveal') {
        const got = p.last?.[c.me.key] ?? 0;
        return void (el.innerHTML = got ? `<div class="screen center good-bg"><div class="result-face">🎯</div><h1 class="big">+${got}</h1><p>Look at the TV!</p></div>` : `<div class="screen center bad-bg"><div class="result-face">🙈</div><h1 class="big">Missed it</h1><p>Look at the TV!</p></div>`);
      }
      el.innerHTML = lookAtTv(p.phase === 'pick' ? 'A colour is being picked…' : 'A second clue is coming…');
    },
  };
  return view;
}
