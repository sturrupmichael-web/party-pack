import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { pickList, sentScreen, yesNo } from '../../ui/components';
import { esc } from '../../ui/dom';

const who = (players: Player[], key: string | null | undefined) => players.find((p) => p.key === key);
const nameOf = (players: Player[], key: string | null | undefined) => esc(who(players, key)?.name ?? '?');
const chip = (players: Player[], key: string | null | undefined, size = 64) => {
  const p = who(players, key);
  return p ? `<span class="pchip" style="--pc:${color(p.look)}">${avatar(p.look, size)}<b>${esc(p.name)}</b></span>` : '';
};

const OUTCOME: Record<string, (m: string, g: string) => string> = {
  caught: (m) => `${m} was caught, and missed the place. The crew wins!`,
  'mole-missed': (m, g) => `${m} guessed ${g}. Wrong! The crew wins!`,
  'wrong-accuse': (m) => `You voted out the wrong person! ${m} wins.`,
  'no-majority': (m) => `No clear vote, so ${m} slips away and wins.`,
  'mole-guessed': (m, g) => `${m} worked out it was ${g}. The mole wins!`,
  'caught-guessed': (m, g) => `${m} was caught but named ${g}. The mole steals the win!`,
};

function boardGrid(board: string[], highlight?: string | null, miss?: string | null): string {
  return `<div class="places">${board.map((b) => `<span class="${b === highlight ? 'hit' : b === miss ? 'miss' : ''}">${esc(b)}</span>`).join('')}</div>`;
}

export const moleViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}:${c.pub.phase}:${c.pub.accuse?.target ?? ''}`,
    mount(el, c) {
      const p = c.pub;
      const P = c.players;
      if (p.phase === 'brief') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="intro">
          <div class="intro-badge">🕵️</div>
          <div class="kicker">Round ${p.round + 1} of ${p.rounds}</div>
          <h1 class="title-xl">Mole Hunt</h1>
          ${p.round === 0 ? `<ol class="rules">
            <li>Check your phone in secret: everyone gets the same <b>place</b>, except the <b>mole</b>.</li>
            <li>Take turns asking each other questions out loud. Be vague enough to fool the mole.</li>
            <li>Anyone can <b>accuse</b> once a round. The mole can <b>guess the place</b> at any time.</li>
          </ol>` : '<p class="rules">New place, new mole. Check your phone!</p>'}
        </div>`;
        return;
      }
      if (p.phase === 'ask') {
        el.innerHTML = `<div class="mole-ask">
          <div class="mole-left">
            <div class="kicker">Round ${p.round + 1} of ${p.rounds}</div>
            <h1 class="title-l">Ask away!</h1>
            <p class="lead">${chip(P, p.firstAsker)} asks first. Whoever answers asks next.</p>
            <ul class="tips"><li>Think someone's the mole? Accuse them on your phone.</li><li>Mole: tap <b>I know the place!</b> when you've worked it out.</li></ul>
          </div>
          <div class="mole-right"><div class="kicker">Possible places</div>${boardGrid(p.board)}</div>
        </div>`;
        return;
      }
      if (p.phase === 'accuse') {
        c.sfx.bad();
        el.innerHTML = `<div class="intro">
          <h1 class="title-l">${chip(P, p.accuse.by)} accuses ${chip(P, p.accuse.target)}</h1>
          <p class="rules">Everyone else, vote on your phone. It takes <b>everyone</b> to agree, and one NO clears them.</p>
          <p class="muted vcount">${p.accuse.voted} voted</p>
        </div>`;
        return;
      }
      if (p.phase === 'final') {
        c.sfx.buzzer();
        el.innerHTML = `<div class="intro">
          <h1 class="title-xl">Time's up!</h1>
          <p class="rules">Vote for the mole on your phone. The most votes is accused.</p>
          <p class="muted vcount">${p.finalVoted.length} voted</p>
        </div>`;
        return;
      }
      if (p.phase === 'guess') {
        c.sfx.reveal();
        el.innerHTML = `<div class="intro">
          <div class="kicker">Caught!</div>
          <h1 class="title-l">The mole is… someone!</h1>
          <p class="rules">The mole gets one last chance: if they can name the place, they still win.</p>
        </div>`;
        return;
      }
      if (p.phase === 'reveal') {
        c.sfx.reveal();
        const m = who(P, p.mole);
        const moleWon = ['wrong-accuse', 'no-majority', 'mole-guessed', 'caught-guessed'].includes(p.outcome);
        setTimeout(() => (moleWon ? c.sfx.bad() : c.sfx.good()), 600);
        const pts = Object.entries(p.last as Record<string, number>)
          .map(([k, n]) => `<span class="pick-chip right">${avatar(who(P, k)?.look ?? 0, 48)}<span class="nm">${nameOf(P, k)}</span><b>+${n}</b></span>`)
          .join('');
        el.innerHTML = `<div class="mole-reveal">
          <div class="kicker">The place was</div>
          <h1 class="title-xl pop">${esc(p.place)}</h1>
          <div class="mole-who pop">${m ? avatar(m.look, 120) : ''}<div><small>The mole was</small><b style="color:${m ? color(m.look) : 'inherit'}">${esc(m?.name ?? '?')}</b></div></div>
          <p class="outcome ${moleWon ? 't-bad' : 't-good'}">${esc(OUTCOME[p.outcome]?.(m?.name ?? 'The mole', p.moleGuess ?? '') ?? '')}</p>
          <div class="picks center">${pts}</div>
        </div>`;
      }
    },
    update(el, c) {
      const v = el.querySelector('.vcount');
      if (v && c.pub.phase === 'accuse') v.textContent = `${c.pub.accuse.voted} voted`;
      if (v && c.pub.phase === 'final') v.textContent = `${c.pub.finalVoted.length} voted`;
    },
  },
  phone: phoneView(),
};

function phoneView(): GameViews['phone'] {
  let mode: 'card' | 'accuse' | 'guess' = 'card';
  let peek = false;
  let at = '';
  let sentVote = '';

  const others = (c: PhoneViewCtx) =>
    (c.pub.seats as string[])
      .filter((k) => k !== c.me.key)
      .map((k) => {
        const p = c.players.find((x: Player) => x.key === k);
        return { id: k, label: p?.name ?? k, icon: p ? avatar(p.look, 34) : '' };
      });

  const view: GameViews['phone'] = {
    key(c) {
      const here = `${c.pub.round}:${c.pub.phase}`;
      if (here !== at) {
        at = here;
        mode = 'card';
        sentVote = '';
      }
      const pr = c.priv ?? {};
      return `${here}:${mode}:${peek}:${pr.canAccuse}:${pr.voted || sentVote === here}`;
    },
    mount(el, c) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const send = (d: Record<string, unknown>) => c.send({ ...d, round: p.round });
      const redraw = () => {
        view.key(c);
        view.mount(el, c);
      };
      if (pr.audience) {
        el.innerHTML = lookAtTv("You're in on it", p.phase === 'reveal' ? '' : `The place is ${pr.place}. Watch the mole squirm.`);
        return;
      }
      if (p.phase === 'brief' || p.phase === 'ask') {
        if (mode === 'accuse') {
          return pickList(el, { title: 'Who is the mole?', sub: 'You can only accuse once a round.', items: others(c), back: () => ((mode = 'card'), redraw()), onPick: (id) => {
            send({ t: 'accuse', target: id });
            mode = 'card';
          } });
        }
        if (mode === 'guess') {
          return pickList(el, { title: 'Where are we?', sub: 'One guess. Right wins, wrong loses.', items: (p.board as string[]).map((b) => ({ id: b, label: b })), cols: 2, back: () => ((mode = 'card'), redraw()), onPick: (id) => send({ t: 'guess', place: id }) });
        }
        const face = pr.mole
          ? `<div class="big">🕵️ You're the mole</div><p>Blend in, and work out the place from the questions.</p>`
          : `<small class="muted">The place</small><div class="big">${esc(pr.place)}</div><p>You're the <b>${esc(pr.role)}</b></p>`;
        el.innerHTML = `<div class="screen">
          <button class="card-btn ${peek ? 'open' : ''}" data-peek>${peek ? face : '<div class="big">🂠</div><p>Tap to see your card in secret</p>'}</button>
          ${p.phase === 'ask' ? (pr.mole ? '<button class="btn primary huge" data-guess>I know the place!</button>' : pr.canAccuse ? '<button class="btn huge" data-acc>Accuse someone</button>' : '<p class="muted center-t">You\'ve used your accusation this round.</p>') : ''}
        </div>`;
        el.querySelector('[data-peek]')!.addEventListener('click', () => {
          peek = !peek;
          redraw();
        });
        el.querySelector('[data-acc]')?.addEventListener('click', () => ((mode = 'accuse'), redraw()));
        el.querySelector('[data-guess]')?.addEventListener('click', () => ((mode = 'guess'), redraw()));
        return;
      }
      const here = `${p.round}:${p.phase}`;
      if (p.phase === 'accuse') {
        if (p.accuse.target === c.me.key) return void (el.innerHTML = lookAtTv("You've been accused!", 'Talk your way out of it.'));
        if (pr.voted || sentVote === here) return void (el.innerHTML = sentScreen('Vote in'));
        const name = others(c).find((o) => o.id === p.accuse.target)?.label ?? 'them';
        return yesNo(el, { title: `Is ${name} the mole?`, yes: 'Yes, it\'s them', no: 'No', onPick: (yes) => {
          send({ t: 'vote', yes });
          sentVote = here;
          redraw();
        } });
      }
      if (p.phase === 'final') {
        if (pr.voted || sentVote === here) return void (el.innerHTML = sentScreen('Vote in'));
        return pickList(el, { title: 'Vote for the mole', items: others(c), onPick: (id) => {
          send({ t: 'final', target: id });
          sentVote = here;
          redraw();
        } });
      }
      if (p.phase === 'guess') {
        if (pr.mole) return pickList(el, { title: 'Caught! Name the place to still win', items: (p.board as string[]).map((b) => ({ id: b, label: b })), cols: 2, onPick: (id) => send({ t: 'guess', place: id }) });
        return void (el.innerHTML = lookAtTv('The mole is guessing…'));
      }
      if (p.phase === 'reveal') {
        const got = p.last?.[c.me.key] ?? 0;
        el.innerHTML = got ? `<div class="screen center good-bg"><div class="result-face">🎉</div><h1 class="big">+${got}</h1><p>Look at the TV!</p></div>` : `<div class="screen center bad-bg"><div class="result-face">😶</div><h1 class="big">No points</h1><p>Look at the TV!</p></div>`;
        peek = false;
        return;
      }
      el.innerHTML = lookAtTv();
    },
  };
  return view;
}
