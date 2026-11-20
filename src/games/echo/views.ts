import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { sentScreen, textForm } from '../../ui/components';
import { esc } from '../../ui/dom';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const chip = (P: Player[], k: string | null | undefined, size = 64) => {
  const p = who(P, k);
  return p ? `<span class="pchip" style="--pc:${color(p.look)}">${avatar(p.look, size)}<b>${esc(p.name)}</b></span>` : '';
};
const WHY: Record<string, string> = { dup: 'Same as another clue', word: 'Gives the word away', filter: 'Filtered' };

function clueCards(P: Player[], clues: Array<{ key: string; text: string | null; why: string | null }>, reveal: boolean): string {
  if (!clues.length) return '<p class="muted">No clues came in!</p>';
  return `<div class="clue-cards">${clues
    .map((c, i) => {
      const p = who(P, c.key);
      const dead = !!c.why;
      return `<div class="clue-card ${dead ? 'dead' : ''}" style="--pc:${p ? color(p.look) : '#888'};animation-delay:${i * 0.12}s">
        <b>${c.text ? esc(c.text) : '✗'}</b>
        <small>${dead ? WHY[c.why!] : reveal ? '' : ''}${p ? ` · ${esc(p.name)}` : ''}</small>
      </div>`;
    })
    .join('')}</div>`;
}

let lastSent = 0;

export const echoViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}:${c.pub.phase}`,
    mount(el, c) {
      const p = c.pub;
      const P = c.players;
      if (p.phase === 'ready') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="intro">
          <div class="intro-badge">🔊</div>
          <div class="kicker">Round ${p.round + 1} of ${p.rounds}</div>
          <h1 class="title-l">${chip(P, p.guesser, 96)} is guessing</h1>
          ${p.round === 0
            ? `<ol class="rules"><li>Everyone else sees a secret word and writes a <b>one-word clue</b>.</li><li>Clues that <b>match</b> cancel out, so be helpful <i>and</i> different.</li><li>Right guess: <b>${600}</b> for the guesser, <b>300</b> for every clue that survived.</li></ol>`
            : '<p class="rules">Guesser: eyes off everyone else\'s phone!</p>'}
        </div>`;
        return;
      }
      if (p.phase === 'clue') {
        lastSent = p.sent.length;
        el.innerHTML = `<div class="intro">
          <div class="kicker">Round ${p.round + 1} of ${p.rounds}</div>
          <h1 class="title-l">Write your clues</h1>
          <p class="rules">${chip(P, p.guesser)} is waiting to guess. One word each!</p>
          <div class="lock-row">${lockRow(c)}</div>
        </div>`;
        return;
      }
      if (p.phase === 'guess') {
        c.sfx.reveal();
        el.innerHTML = `<div class="intro">
          <div class="kicker">${chip(P, p.guesser)}, what's the word?</div>
          ${clueCards(P, p.clues, false)}
          <p class="muted">Guess on your phone.</p>
        </div>`;
        return;
      }
      if (p.phase === 'reveal') {
        c.sfx.reveal();
        setTimeout(() => (p.correct ? c.sfx.good() : c.sfx.bad()), 500);
        el.innerHTML = `<div class="intro">
          <div class="kicker">The word was</div>
          <h1 class="title-xl pop">${esc(p.word)}</h1>
          <p class="outcome ${p.correct ? 't-good' : 't-bad'}">${p.passed ? `${esc(who(P, p.guesser)?.name ?? '')} passed.` : `${esc(who(P, p.guesser)?.name ?? '')} guessed “${esc(p.guess ?? '…')}”. ${p.correct ? 'Correct!' : 'Not quite.'}`}</p>
          ${clueCards(P, p.clues, true)}
        </div>`;
      }
    },
    update(el, c) {
      if (c.pub.phase !== 'clue') return;
      const row = el.querySelector('.lock-row');
      if (row) row.innerHTML = lockRow(c);
      if (c.pub.sent.length > lastSent) c.sfx.lock();
      lastSent = c.pub.sent.length;
    },
  },
  phone: phoneView(),
};

function lockRow(c: { pub: any; players: Player[] }): string {
  const done = new Set<string>(c.pub.sent);
  return (c.pub.seats as string[])
    .filter((k) => k !== c.pub.guesser)
    .map((k) => who(c.players, k))
    .filter((p): p is Player => !!p)
    .map((p) => `<div class="lock-chip ${done.has(p.key) ? 'in' : ''}" style="--pc:${color(p.look)}">${avatar(p.look, 56)}<span>${esc(p.name)}</span><b>${done.has(p.key) ? '✓' : '…'}</b></div>`)
    .join('');
}

function phoneView(): GameViews['phone'] {
  let sent = '';
  let sentAt = 0;
  const view: GameViews['phone'] = {
    key: (c) => `${c.pub.round}:${c.pub.phase}:${c.priv?.clue ?? ''}:${sent === `${c.pub.round}:${c.pub.phase}`}`,
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const here = `${p.round}:${p.phase}`;
      if (pr.audience) return void (el.innerHTML = lookAtTv(p.phase === 'reveal' ? 'Look at the TV!' : `The word is ${String(pr.word ?? '').toUpperCase()}`, 'You\'re watching this one.'));
      if (pr.guesser) {
        if (p.phase === 'guess') {
          if (sent === here) return void (el.innerHTML = sentScreen('Guess in'));
          return textForm(el, { title: 'Read the clues on the TV', placeholder: 'Your guess', oneWord: true, button: 'Guess', max: 24, draft: { get: () => c.draft.get(`g${p.round}`), set: (v) => c.draft.set(`g${p.round}`, v) }, alt: { label: 'Pass', onClick: () => {
            c.send({ t: 'guess', text: '', round: p.round });
            sent = here;
            view.mount(el, c);
          } }, onSubmit: (text) => {
            c.send({ t: 'guess', text, round: p.round });
            sent = here;
            view.mount(el, c);
          } });
        }
        if (p.phase === 'reveal') return void (el.innerHTML = p.correct ? `<div class="screen center good-bg"><div class="result-face">🎉</div><h1 class="big">+600</h1><p>It was ${esc(String(p.word).toUpperCase())}!</p></div>` : `<div class="screen center bad-bg"><div class="result-face">😵</div><h1 class="big">It was ${esc(String(p.word).toUpperCase())}</h1></div>`);
        return void (el.innerHTML = lookAtTv("You're guessing!", "Don't peek at anyone's phone."));
      }
      if (p.phase === 'ready' || p.phase === 'clue') {
        if (pr.clue || sent === here) return void (el.innerHTML = sentScreen(`“${pr.clue ?? '…'}” sent`, 'Waiting for the others'));
        if (p.phase === 'ready') return void (el.innerHTML = `<div class="screen center"><div class="secret"><small>The word</small><b>${esc(pr.word)}</b></div><p class="muted">Think of a one-word clue…</p></div>`);
        return textForm(el, {
          title: 'Write a one-word clue',
          above: `<div class="secret"><small>The word</small><b>${esc(pr.word)}</b></div>`,
          placeholder: 'One word',
          oneWord: true,
          max: 24,
          button: 'Send clue',
          draft: { get: () => c.draft.get(`c${p.round}`), set: (v) => c.draft.set(`c${p.round}`, v) },
          onSubmit: (text) => {
            c.send({ t: 'clue', text, round: p.round });
            c.draft.set(`c${p.round}`, text);
            sent = here;
            sentAt = Date.now();
            el.innerHTML = sentScreen(`“${text}” sent`, 'Waiting for the others');
          },
        });
      }
      if (p.phase === 'reveal') {
        const got = p.last?.[c.me.key] ?? 0;
        return void (el.innerHTML = got ? `<div class="screen center good-bg"><div class="result-face">🎉</div><h1 class="big">+${got}</h1><p>Your clue helped!</p></div>` : lookAtTv());
      }
      el.innerHTML = lookAtTv();
    },
    update(el, c) {
      // A clue that never reached the host: send it again.
      const p = c.pub;
      if (p.phase === 'clue' && sent === `${p.round}:clue` && !c.priv?.clue) {
        const t = c.draft.get(`c${p.round}`);
        if (t && Date.now() - sentAt > 2000) {
          sentAt = Date.now();
          c.send({ t: 'clue', text: t, round: p.round });
        }
      }
      void el;
    },
  };
  return view;
}
