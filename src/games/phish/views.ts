import type { GameViews, HostViewCtx, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv, markClues } from '../../ui/common';
import { esc } from '../../ui/dom';

const KIND_LABEL: Record<string, string> = { email: 'an email', url: 'a link', sms: 'a text message' };
const KIND_ICON: Record<string, string> = { email: '✉️', url: '🔗', sms: '💬' };

interface Item {
  kind: 'email' | 'url' | 'sms';
  from?: string;
  subject?: string;
  body: string;
  url?: string;
  context?: string;
}

/** The message as it would look in a mail app, a browser or a phone. */
export function messageCard(item: Item, clues: Array<{ text: string }> | null): string {
  const m = (t?: string) => markClues(t, clues);
  const ctx = item.context ? `<div class="msg-context">${esc(item.context)}</div>` : '';
  if (item.kind === 'email') {
    return `${ctx}<div class="msg email">
      <div class="msg-chrome"><span>Inbox</span></div>
      <div class="hdr"><b>From</b><span>${m(item.from)}</span></div>
      <div class="hdr"><b>Subject</b><span class="subj">${m(item.subject)}</span></div>
      <div class="msg-body">${m(item.body)}</div>
    </div>`;
  }
  if (item.kind === 'url') {
    const secure = item.url?.startsWith('https://');
    return `${ctx}<div class="msg browser">
      <div class="msg-chrome"><i></i><i></i><i></i>
        <div class="urlbar"><span class="lock ${secure ? 'ok' : 'bad'}">${secure ? '🔒' : '⚠ Not secure'}</span><span class="u">${m(item.url)}</span></div>
      </div>
      <div class="page"><div class="page-title">${m(item.body)}</div><div class="fake-input"></div><div class="fake-input"></div><div class="fake-btn"></div></div>
    </div>`;
  }
  return `${ctx}<div class="msg sms">
    <div class="sms-from">${m(item.from)}</div>
    <div class="bubble">${m(item.body)}</div>
  </div>`;
}

function seated(players: Player[], keys: string[]): Player[] {
  return keys.map((k) => players.find((p) => p.key === k)).filter((p): p is Player => !!p);
}

function lockRow(c: HostViewCtx): string {
  const done = new Set<string>(c.pub.answered);
  return seated(c.players, c.pub.seats)
    .map((p) => `<div class="lock-chip ${done.has(p.key) ? 'in' : ''}" style="--pc:${color(p.look)}">${avatar(p.look, 56)}<span>${esc(p.name)}</span><b>${done.has(p.key) ? '✓' : '…'}</b></div>`)
    .join('');
}

let lastAnswered = 0;

export const phishViews: GameViews = {
  host: {
    key: (c) => `${c.pub.phase}:${c.pub.round}`,
    mount(el, c) {
      const p = c.pub;
      if (p.phase === 'intro') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="intro phish-intro">
          <div class="intro-badge">🎣</div>
          <h1 class="title-xl">Phish <span class="or">or</span> Legit</h1>
          <ol class="rules">
            <li>An email, link or text appears on the TV.</li>
            <li>Tap <b class="t-bad">PHISH</b> or <b class="t-good">LEGIT</b> on your phone.</li>
            <li>Right answers score <b>500</b>, plus up to <b>500</b> more for speed.</li>
          </ol>
          <p class="muted">${p.rounds} rounds</p>
        </div>`;
        return;
      }
      if (p.phase === 'ready') {
        c.sfx.whoosh();
        el.innerHTML = `<div class="intro ready pop">
          <div class="kicker">Round ${p.round + 1} of ${p.rounds}</div>
          <h1 class="title-xl">${KIND_ICON[p.kind]} Here comes ${KIND_LABEL[p.kind]}…</h1>
        </div>`;
        return;
      }
      if (p.phase === 'answer') {
        lastAnswered = p.answered.length;
        el.innerHTML = `<div class="phish-play">
          <div class="kicker">Round ${p.round + 1} of ${p.rounds} · Phish or legit?</div>
          <div class="msg-wrap slide-in">${messageCard(p.item, null)}</div>
          <div class="lock-row">${lockRow(c)}</div>
        </div>`;
        return;
      }
      if (p.phase === 'reveal') {
        c.sfx.reveal();
        const isPhish = p.answer === 'phish';
        const picks = seated(c.players, p.seats)
          .map((pl) => {
            const a = p.picks?.[pl.key];
            const right = a && a.pick === p.answer;
            return `<div class="pick-chip ${a ? (right ? 'right' : 'wrong') : 'none'}">${avatar(pl.look, 52)}<span class="nm">${esc(pl.name)}</span><b>${a ? (right ? `+${a.pts}` : '✗') : '—'}</b></div>`;
          })
          .join('');
        const crowd = p.crowd ? `<div class="crowd">Audience: ${p.crowd.phish} phish · ${p.crowd.legit} legit</div>` : '';
        el.innerHTML = `<div class="phish-reveal">
          <div class="reveal-left">${messageCard(p.item, p.clues)}</div>
          <div class="reveal-right">
            <div class="stamp ${isPhish ? 'bad' : 'good'}">${isPhish ? '🎣 PHISH' : '✅ LEGIT'}</div>
            <ol class="clues">${(p.clues as Array<{ why: string }>).map((cl, i) => `<li style="animation-delay:${0.6 + i * 0.5}s"><span class="n">${i + 1}</span>${esc(cl.why)}</li>`).join('')}</ol>
            <div class="picks">${picks}</div>
            ${crowd}
          </div>
        </div>`;
        const anyRight = Object.values(p.picks ?? {}).some((a: any) => a.pick === p.answer);
        setTimeout(() => (anyRight ? c.sfx.good() : c.sfx.bad()), 500);
        return;
      }
      el.innerHTML = '';
    },
    update(el, c) {
      if (c.pub.phase !== 'answer') return;
      const row = el.querySelector('.lock-row');
      if (row) row.innerHTML = lockRow(c);
      if (c.pub.answered.length > lastAnswered) c.sfx.lock();
      lastAnswered = c.pub.answered.length;
    },
  },

  phone: phoneView(),
};

function phoneView(): GameViews['phone'] {
  // What this phone tapped, by round, until the host confirms it.
  let sent: { round: number; pick: string; at: number } | null = null;

  const myPick = (c: PhoneViewCtx): string | null => c.priv?.pick ?? (sent && sent.round === c.pub.round ? sent.pick : null);

  return {
    key: (c) => `${c.pub.phase}:${c.pub.round}:${myPick(c) ?? ''}`,
    mount(el, c) {
      const p = c.pub;
      if (p.phase === 'answer') {
        const pick = myPick(c);
        if (pick) {
          el.innerHTML = `<div class="screen center"><div class="locked ${pick === 'phish' ? 'bad' : 'good'}">${pick === 'phish' ? '🎣 PHISH' : '✅ LEGIT'}</div><h2>Locked in</h2><p class="muted">Look at the TV!</p></div>`;
          return;
        }
        el.innerHTML = `<div class="screen two-choice">
          <p class="prompt">Round ${p.round + 1} of ${p.rounds}: is it…</p>
          <button class="choice bad" data-pick="phish">🎣<span>PHISH</span></button>
          <button class="choice good" data-pick="legit">✅<span>LEGIT</span></button>
        </div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
          b.addEventListener('click', () => {
            sent = { round: p.round, pick: b.dataset.pick!, at: Date.now() };
            c.send({ round: p.round, pick: sent.pick });
            try {
              navigator.vibrate?.(30);
            } catch {
              /* ignore */
            }
            phishViews.phone.mount(el, c); // show "locked in" right away
          }),
        );
        return;
      }
      if (p.phase === 'reveal') {
        const pr = c.priv ?? {};
        if (c.me.role === 'audience') {
          el.innerHTML = lookAtTv(`It was ${String(pr.answer ?? p.answer).toUpperCase()}`, pr.pick ? (pr.correct ? 'You called it!' : 'Not this time.') : 'Audience picks don\'t score.');
          return;
        }
        if (!pr.pick) {
          el.innerHTML = `<div class="screen center"><div class="result-face">⏰</div><h1 class="big">Too slow!</h1><p class="muted">It was ${esc(String(pr.answer).toUpperCase())}.</p></div>`;
        } else if (pr.correct) {
          el.innerHTML = `<div class="screen center good-bg"><div class="result-face">🎉</div><h1 class="big">+${pr.pts}</h1><p>Correct, it was ${esc(String(pr.answer).toUpperCase())}.</p></div>`;
        } else {
          el.innerHTML = `<div class="screen center bad-bg"><div class="result-face">😬</div><h1 class="big">Nope</h1><p>It was ${esc(String(pr.answer).toUpperCase())}.</p></div>`;
        }
        return;
      }
      if (p.phase === 'intro') {
        el.innerHTML = lookAtTv('Phish or Legit', 'Look at the TV for the rules.');
        return;
      }
      el.innerHTML = lookAtTv();
    },
    update(_el, c) {
      // If our tap got lost on the way, send it again (the host ignores repeats).
      if (c.pub.phase === 'answer' && sent && sent.round === c.pub.round && !c.priv?.pick && Date.now() - sent.at > 1500) {
        sent.at = Date.now();
        c.send({ round: sent.round, pick: sent.pick });
      }
    },
  };
}
