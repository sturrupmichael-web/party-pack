import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { esc } from '../../ui/dom';
import { TEAM_NAMES } from './logic';

export const TEAM_COLORS = ['#2ec4b6', '#ff6b6b'];
const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const cardClass = (c: unknown) => (c === 0 ? 't0' : c === 1 ? 't1' : c === 'x' ? 'burn' : c === 'n' ? 'neutral' : '');
const teamTag = (t: number) => `<b style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]}</b>`;

function teamPanel(P: Player[], pub: any, t: 0 | 1): string {
  const members = (pub.teams[t] as string[])
    .map((k) => who(P, k))
    .filter((p): p is Player => !!p)
    .map((p) => `<li>${avatar(p.look, 44)}<span>${esc(p.name)}</span>${pub.givers[t] === p.key ? '<em>🔑 code-giver</em>' : ''}</li>`)
    .join('');
  return `<div class="cv-team ${pub.turn === t && (pub.phase === 'clue' || pub.phase === 'guess') ? 'active' : ''}" style="--tc:${TEAM_COLORS[t]}">
    <h2>${TEAM_NAMES[t]}</h2><div class="cv-left">${pub.left[t]}<small> words left</small></div><ul>${members}</ul></div>`;
}

function board(P: Player[], pub: any): string {
  const votes: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(pub.votes as Record<string, number | 'end'>)) if (v !== 'end') (votes[v] ??= []).push(k);
  return `<div class="cv-board">${(pub.words as string[])
    .map((w, i) => {
      const shown = pub.shown[i];
      const rev = pub.revealed[i];
      const vs = (votes[i] ?? []).map((k) => avatar(who(P, k)?.look ?? 0, 34)).join('');
      return `<div class="cv-card ${rev ? `rev ${cardClass(shown)}` : shown !== null ? `ghost ${cardClass(shown)}` : ''}"><span>${esc(w)}</span>${rev && shown === 'x' ? '<i>🔥</i>' : ''}<div class="cv-votes">${vs}</div></div>`;
    })
    .join('')}</div>`;
}

function banner(P: Player[], pub: any): string {
  if (pub.phase === 'clue') return `${teamTag(pub.turn)} · <b>${esc(who(P, pub.givers[pub.turn])?.name ?? '')}</b> is thinking of a clue…`;
  if (pub.phase === 'guess') {
    const ends = Object.values(pub.votes).filter((v) => v === 'end').length;
    return `${teamTag(pub.turn)} · <span class="cv-clue">${esc(pub.clue.word)} · ${pub.clue.n}</span> <small>${pub.guessesLeft} guess${pub.guessesLeft === 1 ? '' : 'es'} left · ${pub.need} vote${pub.need === 1 ? '' : 's'} reveals a word${ends ? ` · ${ends} want to stop` : ''}</small>`;
  }
  if (pub.phase === 'over') return `${teamTag(pub.winner)} wins! <small>${pub.reason === 'burn' ? `${TEAM_NAMES[1 - pub.winner]} hit the Burn word 🔥` : 'All their words found.'}</small>`;
  return '';
}

let lastSig = '';

export const coverViews: GameViews = {
  host: {
    key: (c) => (c.pub.phase === 'teams' ? 'teams' : c.pub.phase === 'over' ? 'over' : 'play'),
    mount(el, c) {
      const p = c.pub;
      const P = c.players;
      if (p.phase === 'teams') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="intro">
          <div class="intro-badge">🗂️</div>
          <h1 class="title-l">Cover Story</h1>
          <div class="cv-teams-intro">${teamPanel(P, p, 0)}${teamPanel(P, p, 1)}</div>
          <ol class="rules small-rules">
            <li>Code-givers 🔑 see the secret key on their phone. Give a <b>one-word clue and a number</b>.</li>
            <li>Your team votes on their phones. Most of the team agreeing reveals a word.</li>
            <li>Find all your words first. Reveal the 🔥 <b>Burn</b> word and your team loses. ${teamTag(p.first)} goes first with 9 words.</li>
          </ol>
        </div>`;
        return;
      }
      if (p.phase === 'over') {
        c.sfx.fanfare();
      }
      lastSig = '';
      el.innerHTML = `<div class="cv-screen"><div class="cv-banner"></div><div class="cv-main">${teamPanel(P, p, 0)}<div class="cv-board-wrap"></div>${teamPanel(P, p, 1)}</div></div>`;
      coverViews.host.update!(el, c);
    },
    update(el, c) {
      const p = c.pub;
      if (p.phase === 'teams') return;
      const sig = JSON.stringify([p.revealed, p.votes, p.turn, p.clue, p.phase, p.guessesLeft, p.need]);
      if (sig === lastSig) return;
      const prev = lastSig ? (JSON.parse(lastSig) as [boolean[], unknown, number]) : null;
      lastSig = sig;
      if (prev) {
        const i = (p.revealed as boolean[]).findIndex((r, j) => r && !prev[0][j]);
        if (i >= 0) {
          const card = p.shown[i];
          if (card === 'x') c.sfx.buzzer();
          else if (card === prev[2]) c.sfx.good();
          else c.sfx.bad();
        } else if (Object.keys(p.votes).length) c.sfx.lock();
      }
      el.querySelector('.cv-banner')!.innerHTML = banner(c.players, p);
      el.querySelector('.cv-board-wrap')!.innerHTML = board(c.players, p);
      const panels = el.querySelectorAll('.cv-main > .cv-team');
      panels[0].outerHTML = teamPanel(c.players, p, 0);
      el.querySelectorAll('.cv-main > .cv-team')[1].outerHTML = teamPanel(c.players, p, 1);
    },
  },
  phone: phoneView(),
};

function keyGrid(pub: any, key: unknown[]): string {
  return `<div class="cv-key">${(pub.words as string[]).map((w, i) => `<span class="${cardClass(key[i])} ${pub.revealed[i] ? 'done' : ''}">${esc(w)}</span>`).join('')}</div>`;
}

function phoneView(): GameViews['phone'] {
  let n = 1;
  let draftWord = '';
  let err = '';
  const view: GameViews['phone'] = {
    key: (c) => {
      const p = c.pub;
      const pr = c.priv ?? {};
      const mine = pr.team === p.turn;
      if (pr.giver) return `g:${p.phase}:${p.turn}:${p.revealed.filter(Boolean).length}`;
      if (p.phase === 'guess' && mine) return `v:${p.revealed.filter(Boolean).length}:${p.turn}`;
      return `w:${p.phase}:${p.turn}:${pr.team}`;
    },
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const t = pr.team as 0 | 1 | null;
      if (t === null) return void (el.innerHTML = lookAtTv('Watch the teams battle', 'You\'re in the audience for this one.'));
      el.parentElement?.style.setProperty('--me', TEAM_COLORS[t]);
      if (p.phase === 'over') {
        const won = p.winner === t;
        return void (el.innerHTML = `<div class="screen center ${won ? 'good-bg' : 'bad-bg'}"><div class="result-face">${won ? '🏆' : '😵'}</div><h1 class="big">${won ? 'Your team wins!' : `${TEAM_NAMES[p.winner]} wins`}</h1><p>Look at the TV!</p></div>`);
      }
      if (pr.giver) {
        const myTurn = p.turn === t && p.phase === 'clue';
        if (!myTurn) {
          el.innerHTML = `<div class="screen"><p class="kicker">You're ${TEAM_NAMES[t]}'s code-giver 🔑. Keep this hidden!</p>${keyGrid(p, pr.key)}<p class="muted center-t">${p.phase === 'teams' ? 'Get ready…' : p.turn === t ? 'Your team is guessing. No hints!' : `${TEAM_NAMES[1 - t]}'s turn.`}</p></div>`;
          return;
        }
        el.innerHTML = `<form class="screen cv-giver">
          ${keyGrid(p, pr.key)}
          <input class="tin" maxlength="24" placeholder="One-word clue" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <div class="cv-nums">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button type="button" data-n="${k}" class="${k === n ? 'on' : ''}">${k}</button>`).join('')}</div>
          ${err ? `<p class="warn center-t">${esc(err)}</p>` : ''}
          <button class="btn primary huge" type="submit">Give clue</button>
        </form>`;
        const input = el.querySelector<HTMLInputElement>('.tin')!;
        input.value = draftWord;
        input.addEventListener('input', () => {
          input.value = input.value.replace(/\s+/g, '');
          draftWord = input.value;
        });
        el.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) =>
          b.addEventListener('click', () => {
            n = Number(b.dataset.n);
            el.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', x === b));
          }),
        );
        el.querySelector('form')!.addEventListener('submit', (e) => {
          e.preventDefault();
          const w = input.value.trim();
          if (!w) return input.focus();
          const onBoard = (p.words as string[]).some((x, i) => !p.revealed[i] && x.toLowerCase() === w.toLowerCase());
          if (onBoard) {
            err = "That word is on the board. Pick another.";
            return view.mount(el, c);
          }
          err = '';
          c.send({ t: 'clue', word: w, n });
          draftWord = '';
          input.blur();
          el.innerHTML = `<div class="screen center"><div class="sent-check">✓</div><h1 class="big">${esc(w)} · ${n}</h1><p class="muted">Look at the TV!</p></div>`;
        });
        return;
      }
      if (p.phase === 'guess' && p.turn === t) {
        const my = pr.vote;
        const counts: Record<string, number> = {};
        for (const v of Object.values(p.votes)) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
        el.innerHTML = `<div class="screen cv-vote">
          <div class="cv-cluebar"><b>${esc(p.clue.word)} · ${p.clue.n}</b><small>${p.guessesLeft} left · ${p.need} vote${p.need === 1 ? '' : 's'} to reveal</small></div>
          <div class="cv-pgrid">${(p.words as string[])
            .map((w, i) => (p.revealed[i] ? `<button disabled class="${cardClass(p.shown[i])}">${esc(w)}</button>` : `<button data-v="${i}" class="${my === i ? 'mine' : ''}">${esc(w)}${counts[i] ? `<em>${counts[i]}</em>` : ''}</button>`))
            .join('')}</div>
          <button class="btn huge ${my === 'end' ? 'primary' : ''}" data-v="end">${my === 'end' ? 'Voted to stop' : 'Stop guessing'}${counts.end ? ` (${counts.end})` : ''}</button>
        </div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
          b.addEventListener('click', () => {
            const v = b.dataset.v === 'end' ? 'end' : Number(b.dataset.v);
            c.send({ t: 'vote', i: v });
            try {
              navigator.vibrate?.(20);
            } catch {
              /* ignore */
            }
          }),
        );
        return;
      }
      const msg = p.phase === 'teams' ? `You're on ${TEAM_NAMES[t]}` : p.turn === t ? 'Your code-giver is thinking…' : `${TEAM_NAMES[1 - t]}'s turn`;
      el.innerHTML = lookAtTv(msg, p.phase === 'teams' ? 'Your code-giver will clue your words.' : 'Look at the TV!');
    },
    update(el, c) {
      // Votes change constantly while guessing: redraw counts in place.
      if (c.pub.phase === 'guess' && c.priv?.team === c.pub.turn && !c.priv?.giver) view.mount(el, c);
    },
  };
  return view;
}
