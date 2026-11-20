import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { pickList } from '../../ui/components';
import { esc } from '../../ui/dom';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const nm = (P: Player[], k: string | null | undefined) => esc(who(P, k)?.name ?? '?');

/** A sauce cup: face down (lid in the owner's colour), mild, or hot. */
export function cup(kind: 'down' | 'mild' | 'hot', tint = '#a99fd6', size = 56): string {
  const body = kind === 'hot' ? '#ff3b30' : kind === 'mild' ? '#fff3c4' : '#3a2e7a';
  const face =
    kind === 'hot'
      ? '<path d="M32 22c6 7 9 11 9 17a9 9 0 0 1-18 0c0-4 2-7 4-9 0 4 2 6 4 6-2-5-1-10 1-14z" fill="#ffd166"/>'
      : kind === 'mild'
        ? '<path d="M24 38q8 6 16 0" stroke="#3ddc97" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="26" cy="31" r="2.5" fill="#120c2c"/><circle cx="38" cy="31" r="2.5" fill="#120c2c"/>'
        : '<text x="32" y="42" text-anchor="middle" font-size="20" font-weight="900" fill="#a99fd6">?</text>';
  return `<svg class="cup" width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M12 16h40l-5 42H17z" fill="${body}" stroke="#120c2c" stroke-width="3" stroke-linejoin="round"/><rect x="9" y="9" width="46" height="9" rx="4" fill="${kind === 'down' ? tint : '#e8e3f7'}" stroke="#120c2c" stroke-width="3"/>${face}</svg>`;
}

function seatHtml(P: Player[], p: any, k: string): string {
  const pl = who(P, k);
  if (!pl) return '';
  const out = p.out.includes(k);
  const flips = (p.flipped as Array<{ owner: string; cup: 'mild' | 'hot' }>).filter((f) => f.owner === k);
  const down = Math.max(0, p.counts[k] - flips.length);
  const cups = [...Array(down).fill(cup('down', color(pl.look), 84)), ...flips.map((f) => `<span class="flip">${cup(f.cup, '', 84)}</span>`)].join('');
  const turn = p.turn === k && p.phase !== 'result' && p.phase !== 'first';
  const placedFirst = p.phase === 'first' && p.firstDone?.includes(k);
  return `<div class="hs-seat ${out ? 'out' : ''} ${turn ? 'turn' : ''}" style="--pc:${color(pl.look)}">
    <div class="hs-who">${avatar(pl.look, 64)}<b>${esc(pl.name)}</b>${p.wins[k] ? `<span class="hs-wins">${'🏆'.repeat(p.wins[k])}</span>` : ''}</div>
    <div class="hs-stack">${cups || (out ? '<span class="muted">out</span>' : p.phase === 'first' ? '<span class="muted">placing…</span>' : '')}</div>
    <small class="muted">${out ? 'No cups left' : `${p.owned[k]} cup${p.owned[k] === 1 ? '' : 's'} owned`}${placedFirst ? ' · ✓' : ''}${p.taster === k ? ' · 🥄 tasting' : ''}${p.bid?.passed.includes(k) ? ' · passed' : ''}</small>
  </div>`;
}

function banner(P: Player[], p: any): string {
  switch (p.phase) {
    case 'first':
      return 'Everyone: put your first cup down on your phone. Mild or hot? Nobody will know.';
    case 'turn':
      return `<b>${nm(P, p.turn)}</b>: add a cup, or start the bidding.`;
    case 'bid':
      return `Bid: <b class="hs-bid">${p.bid.high}</b> by ${nm(P, p.bid.by)} · <b>${nm(P, p.turn)}</b> to raise or pass · ${p.total} cups on the table`;
    case 'taste': {
      const mild = (p.flipped as any[]).filter((f) => f.cup === 'mild').length;
      return `<b>${nm(P, p.taster)}</b> is tasting: <b class="hs-bid">${mild} / ${p.bid.high}</b> mild so far`;
    }
    case 'result': {
      const r = p.result;
      if (p.winner) return `🏆 <b>${nm(P, p.winner)}</b> wins Hot Sauce!`;
      if (r.ok) return `😋 <b>${nm(P, r.taster)}</b> made it! That's a win.`;
      return `🔥 <b>${nm(P, r.taster)}</b> hit ${r.hotOwner === r.taster ? 'their own' : `${nm(P, r.hotOwner)}'s`} hot sauce and loses a cup${r.outNow ? ' and is out!' : '.'}`;
    }
  }
  return '';
}

let lastSig = '';

export const sauceViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}`,
    mount(el, c) {
      lastSig = '';
      if (c.pub.round === 1) c.sfx.whoosh();
      el.innerHTML = `<div class="hs-screen">
        ${c.pub.round === 1 ? '<div class="hs-rules">Everyone has 3 mild cups and 1 hot. Stack them face down, bid how many you can taste, and taste your own stack first. Two wins takes it. Hit a hot one and lose a cup.</div>' : ''}
        <div class="hs-banner"></div><div class="hs-table"></div></div>`;
      sauceViews.host.update!(el, c);
    },
    update(el, c) {
      const p = c.pub;
      const sig = JSON.stringify([p.phase, p.counts, p.flipped, p.turn, p.bid, p.firstDone]);
      if (sig === lastSig) return;
      const prev = lastSig ? JSON.parse(lastSig) : null;
      lastSig = sig;
      if (prev) {
        if (p.flipped.length > prev[2].length) (p.flipped.at(-1).cup === 'hot' ? c.sfx.buzzer() : c.sfx.good());
        else if (p.phase === 'result' && prev[0] !== 'result') p.result.ok ? c.sfx.fanfare() : c.sfx.bad();
        else c.sfx.lock();
      }
      el.querySelector('.hs-banner')!.innerHTML = banner(c.players, p);
      el.querySelector('.hs-table')!.innerHTML = (p.order as string[]).map((k) => seatHtml(c.players, p, k)).join('');
    },
  },
  phone: phoneView(),
};

function myCups(pr: any): string {
  const st = (pr.stack as Array<'mild' | 'hot'>).map((k) => cup(k, '', 36)).join('');
  return `<div class="hs-mine"><small>Your stack (bottom → top)</small><div>${st || '<span class="muted">empty</span>'}</div><small>In hand: ${pr.free.mild} mild${pr.free.hot ? ' · 1 hot' : ''}</small></div>`;
}

function phoneView(): GameViews['phone'] {
  let bidding = false;
  const view: GameViews['phone'] = {
    key: (c) => {
      const p = c.pub;
      return `${p.round}:${p.phase}:${p.turn === c.me.key}:${p.counts[c.me.key]}:${p.bid?.high ?? 0}:${p.flipped.length}:${bidding}:${p.firstDone?.includes(c.me.key) ?? ''}`;
    },
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const me = c.me.key;
      const send = (d: Record<string, unknown>) => c.send({ ...d, round: p.round });
      const redraw = () => view.mount(el, c);
      if (pr.audience) return void (el.innerHTML = lookAtTv());
      if (pr.out) return void (el.innerHTML = lookAtTv("You're out of cups", 'Watch the others sweat.'));
      if (p.phase === 'result') {
        const r = p.result;
        bidding = false;
        if (p.winner === me) return void (el.innerHTML = `<div class="screen center good-bg"><div class="result-face">🏆</div><h1 class="big">You win!</h1></div>`);
        if (r.taster === me) return void (el.innerHTML = r.ok ? `<div class="screen center good-bg"><div class="result-face">😋</div><h1 class="big">+500</h1><p>Survived the tasting!</p></div>` : `<div class="screen center bad-bg"><div class="result-face">🥵</div><h1 class="big">Too hot!</h1><p>You lost a ${r.lost ?? ''} cup.</p></div>`);
        return void (el.innerHTML = lookAtTv());
      }
      const placeButtons = (first: boolean) => `
        <button class="choice good hs-choice" data-cup="mild" ${pr.free.mild ? '' : 'disabled'}>${cup('mild', '', 70)}<span>Mild (${pr.free.mild})</span></button>
        <button class="choice bad hs-choice" data-cup="hot" ${pr.free.hot ? '' : 'disabled'}>${cup('hot', '', 70)}<span>Hot${pr.free.hot ? '' : ' (used)'}</span></button>
        ${first ? '' : `<button class="btn huge" data-bid>Start bidding</button>`}`;
      const wirePlace = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-cup]').forEach((b) => b.addEventListener('click', () => send({ t: 'place', cup: b.dataset.cup })));
        el.querySelector('[data-bid]')?.addEventListener('click', () => ((bidding = true), redraw()));
      };
      if (p.phase === 'first') {
        if (p.firstDone?.includes(me)) return void (el.innerHTML = `<div class="screen center">${myCups(pr)}<h1 class="big">Cup down</h1><p class="muted">Waiting for everyone…</p></div>`);
        el.innerHTML = `<div class="screen two-choice"><p class="prompt">Put your first cup down</p>${placeButtons(true)}</div>`;
        return wirePlace();
      }
      const myTurn = p.turn === me;
      if (myTurn && (p.phase === 'turn' || p.phase === 'bid') && (bidding || p.phase === 'bid' || !(pr.free.mild + pr.free.hot))) {
        const min = p.phase === 'bid' ? p.bid.high + 1 : 1;
        const items = [];
        for (let n = min; n <= p.total; n++) items.push({ id: String(n), label: `I can taste ${n}` });
        return pickList(el, {
          title: p.phase === 'bid' ? `Raise the bid (now ${p.bid.high})` : 'How many cups can you taste?',
          sub: `${p.total} cups on the table. Your own stack comes first.`,
          items: p.phase === 'bid' ? [...items, { id: 'pass', label: 'Pass' }] : items,
          cols: items.length > 6 ? 2 : 1,
          back: p.phase === 'turn' && pr.free.mild + pr.free.hot ? () => ((bidding = false), redraw()) : undefined,
          onPick: (id) => {
            bidding = false;
            if (id === 'pass') send({ t: 'pass' });
            else send({ t: 'bid', n: Number(id) });
          },
        });
      }
      if (myTurn && p.phase === 'turn') {
        el.innerHTML = `<div class="screen two-choice"><p class="prompt">Your turn: add a cup or bid</p>${placeButtons(false)}</div>`;
        return wirePlace();
      }
      if (myTurn && p.phase === 'taste') {
        const items = (p.order as string[])
          .filter((k) => k !== me && !p.out.includes(k))
          .map((k) => {
            const flipped = (p.flipped as any[]).filter((f) => f.owner === k).length;
            const pl = who(c.players, k);
            return { id: k, label: `${pl?.name ?? '?'} (${p.counts[k] - flipped} left)`, icon: pl ? avatar(pl.look, 30) : '', disabled: p.counts[k] - flipped <= 0 };
          });
        const mild = (p.flipped as any[]).filter((f) => f.cup === 'mild').length;
        return pickList(el, { title: `Tasting: ${mild} of ${p.bid.high} mild`, sub: 'Pick whose top cup to taste next', items, onPick: (id) => send({ t: 'flip', owner: id }) });
      }
      el.innerHTML = `<div class="screen center">${myCups(pr)}<h1 class="big">${p.phase === 'bid' ? `Bid is ${p.bid.high}` : 'Look at the TV!'}</h1><p class="muted">${p.phase === 'taste' ? `${who(c.players, p.taster)?.name ?? ''} is tasting…` : `${who(c.players, p.turn)?.name ?? ''}'s turn`}</p></div>`;
    },
  };
  return view;
}
