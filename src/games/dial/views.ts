import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { dialSvg, mountDial, sentScreen, textForm } from '../../ui/components';
import { esc } from '../../ui/dom';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const chip = (P: Player[], k: string | null | undefined, size = 64) => {
  const p = who(P, k);
  return p ? `<span class="pchip" style="--pc:${color(p.look)}">${avatar(p.look, size)}<b>${esc(p.name)}</b></span>` : '';
};

function tvDial(spec: [string, string], body: string): string {
  return `<div class="tv-dial">${body}<div class="ends"><span>← ${esc(spec[0])}</span><span>${esc(spec[1])} →</span></div></div>`;
}

let lastLocked = 0;

export const dialViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}:${c.pub.phase}`,
    mount(el, c) {
      const p = c.pub;
      const P = c.players;
      if (p.phase === 'clue') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="dial-screen">
          <div class="dial-side">
            <div class="kicker">Round ${p.round + 1} of ${p.rounds} · first to ${p.goal}</div>
            <h1 class="title-l">${chip(P, p.reader, 80)} is reading</h1>
            ${p.round === 0
              ? `<ol class="rules small-rules"><li>The reader sees a secret spot on the dial and gives a clue for it.</li><li>Everyone else drags the dial on their phone.</li><li>Bullseye <b>400</b>, close <b>300</b>, near <b>200</b>. The reader gets the average.</li><li>First to <b>${p.goal}</b> points, or the most after ${p.rounds} rounds, wins.</li></ol>`
              : '<p class="rules">Thinking of a clue…</p>'}
          </div>
          ${tvDial(p.spectrum, dialSvg({ left: p.spectrum[0], right: p.spectrum[1], shut: true }))}
        </div>`;
        return;
      }
      if (p.phase === 'guess') {
        lastLocked = p.locked.length;
        c.sfx.reveal();
        el.innerHTML = `<div class="dial-screen">
          <div class="dial-side">
            <div class="kicker">${chip(P, p.reader)} says</div>
            <h1 class="clue-big pop">“${esc(p.clue)}”</h1>
            <div class="lock-row left">${lockRow(c)}</div>
          </div>
          ${tvDial(p.spectrum, dialSvg({ left: p.spectrum[0], right: p.spectrum[1], shut: true }))}
        </div>`;
        return;
      }
      if (p.phase === 'reveal') {
        c.sfx.reveal();
        const needles = Object.entries(p.guesses as Record<string, number>).map(([k, v]) => ({ v, color: color(who(P, k)?.look ?? 0) }));
        const crowd = Object.values((p.crowd ?? {}) as Record<string, number>).map((v) => ({ v, color: '#a99fd6' }));
        const rows = Object.entries(p.last as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `<span class="pick-chip ${n ? 'right' : 'wrong'}">${avatar(who(P, k)?.look ?? 0, 48)}<span class="nm">${esc(who(P, k)?.name ?? '')}${k === p.reader ? ' 📖' : ''}</span><b>${n ? `+${n}` : '0'}</b></span>`)
          .join('');
        const best = Math.max(0, ...Object.values(p.last as Record<string, number>));
        setTimeout(() => (best >= 300 ? c.sfx.good() : c.sfx.bad()), 500);
        el.innerHTML = `<div class="dial-screen">
          <div class="dial-side">
            <div class="kicker">${chip(P, p.reader)} said</div>
            <h1 class="clue-big">“${esc(p.clue)}”</h1>
            <div class="picks">${rows}</div>
          </div>
          ${tvDial(p.spectrum, `<div class="pop">${dialSvg({ left: p.spectrum[0], right: p.spectrum[1], target: p.target, needles: [...crowd, ...needles] })}</div>`)}
        </div>`;
      }
    },
    update(el, c) {
      if (c.pub.phase !== 'guess') return;
      const row = el.querySelector('.lock-row');
      if (row) row.innerHTML = lockRow(c);
      if (c.pub.locked.length > lastLocked) c.sfx.lock();
      lastLocked = c.pub.locked.length;
    },
  },
  phone: phoneView(),
};

function lockRow(c: { pub: any; players: Player[] }): string {
  const done = new Set<string>(c.pub.locked);
  return (c.pub.seats as string[])
    .filter((k) => k !== c.pub.reader)
    .map((k) => who(c.players, k))
    .filter((p): p is Player => !!p)
    .map((p) => `<div class="lock-chip ${done.has(p.key) ? 'in' : ''}" style="--pc:${color(p.look)}">${avatar(p.look, 48)}<span>${esc(p.name)}</span><b>${done.has(p.key) ? '✓' : '…'}</b></div>`)
    .join('');
}

function phoneView(): GameViews['phone'] {
  let sent = '';
  const view: GameViews['phone'] = {
    key: (c) => `${c.pub.round}:${c.pub.phase}:${c.priv?.guess != null}:${sent === `${c.pub.round}:${c.pub.phase}`}`,
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const here = `${p.round}:${p.phase}`;
      const spec = p.spectrum as [string, string];
      if (p.phase === 'clue') {
        if (!pr.reader) return void (el.innerHTML = lookAtTv(`${who(c.players, p.reader)?.name ?? 'The reader'} is thinking…`, `${spec[0]} ↔ ${spec[1]}`));
        if (sent === here) return void (el.innerHTML = sentScreen('Clue sent'));
        return textForm(el, {
          title: 'Give a clue for the red zone',
          above: `<div class="dial-wrap">${dialSvg({ left: spec[0], right: spec[1], target: pr.target })}<div class="dial-ends"><span>${esc(spec[0])}</span><span>${esc(spec[1])}</span></div></div>`,
          placeholder: 'A word or short phrase',
          max: 40,
          button: 'Send clue',
          draft: { get: () => c.draft.get(`c${p.round}`), set: (v) => c.draft.set(`c${p.round}`, v) },
          onSubmit: (text) => {
            c.send({ t: 'clue', text, round: p.round });
            sent = here;
            view.mount(el, c);
          },
        });
      }
      if (p.phase === 'guess') {
        if (pr.reader) return void (el.innerHTML = lookAtTv(`Your clue: “${p.clue}”`, 'Keep a straight face!'));
        if (pr.guess != null || sent === here) return void (el.innerHTML = sentScreen('Locked in'));
        const k = `v${p.round}`;
        const start = Number(c.draft.get(k)) || 50;
        el.innerHTML = `<div class="screen dial-phone">
          <p class="kicker">${esc(who(c.players, p.reader)?.name ?? '')} says</p>
          <div class="clue-mid">“${esc(p.clue)}”</div>
          <div class="dial-host"></div>
          <p class="muted hint">Drag the dial</p>
          <button class="btn primary huge" data-lock>Lock in</button>
        </div>`;
        const dial = mountDial(el.querySelector<HTMLElement>('.dial-host')!, { left: spec[0], right: spec[1], value: start, color: color(c.me.look), onChange: (v) => c.draft.set(k, String(v)) });
        el.querySelector('[data-lock]')!.addEventListener('click', () => {
          c.send({ t: 'guess', v: dial.get(), round: p.round });
          sent = here;
          view.mount(el, c);
        });
        return;
      }
      if (p.phase === 'reveal') {
        const got = p.last?.[c.me.key];
        if (got == null) return void (el.innerHTML = lookAtTv());
        return void (el.innerHTML = got
          ? `<div class="screen center good-bg"><div class="result-face">${got >= 400 ? '🎯' : '🎉'}</div><h1 class="big">+${got}</h1><p>Look at the TV!</p></div>`
          : `<div class="screen center bad-bg"><div class="result-face">🙈</div><h1 class="big">Way off!</h1><p>Look at the TV!</p></div>`);
      }
      el.innerHTML = lookAtTv();
    },
  };
  return view;
}
