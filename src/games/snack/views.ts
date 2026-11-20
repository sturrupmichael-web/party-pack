import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { esc } from '../../ui/dom';
import { CARDS, type Breakdown, type CardId, POINT_RATE, ROUNDS } from './logic';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const card = (id: CardId) => CARDS.find((c) => c.id === id)!;
const ORDER = CARDS.map((c) => c.id);

/** A spread as grouped emoji chips: 🍕×3 🌮×2 … */
function spreadHtml(spread: CardId[], fresh?: CardId): string {
  const counts = new Map<CardId, number>();
  for (const c of spread) counts.set(c, (counts.get(c) ?? 0) + 1);
  return ORDER.filter((id) => counts.has(id))
    .map((id) => `<span class="ss-chip ${id === fresh ? 'fresh' : ''}" title="${card(id).name}">${card(id).emoji}<b>${counts.get(id)! > 1 ? `×${counts.get(id)}` : ''}</b></span>`)
    .join('');
}

function legend(): string {
  return `<div class="ss-legend">${CARDS.map((c) => `<div><span>${c.emoji}</span><b>${c.name}</b><small>${c.rule}</small></div>`).join('')}</div>`;
}

function seats(P: Player[], p: any): string {
  return (p.order as string[])
    .map((k) => {
      const pl = who(P, k);
      if (!pl) return '';
      const done = p.phase === 'pick' && p.done.includes(k);
      const fresh = p.last?.[k] as CardId | undefined;
      return `<div class="ss-seat ${done ? 'done' : ''}" style="--pc:${color(pl.look)}">
        <div class="ss-who">${avatar(pl.look, 56)}<b>${esc(pl.name)}</b>${done ? '<i>✓</i>' : ''}${p.jars[k] ? `<span class="ss-jar">🍪${p.jars[k]}</span>` : ''}</div>
        ${fresh ? `<div class="ss-fresh">${card(fresh).emoji}</div>` : ''}
        <div class="ss-spread">${spreadHtml(p.spreads[k].filter((c: CardId) => c !== 'cookie'), fresh)}</div>
      </div>`;
    })
    .join('');
}

function parts(b: Breakdown): string {
  return ORDER.filter((id) => b.parts[id] != null)
    .map((id) => `<span class="${b.parts[id]! < 0 ? 'neg' : ''}">${card(id).emoji} ${b.parts[id]! > 0 ? '+' : ''}${b.parts[id]}</span>`)
    .join('');
}

function scoreTable(P: Player[], p: any): string {
  const final = p.phase !== 'score';
  const rs = p.roundScores as Array<Record<string, Breakdown>>;
  const cur = rs[rs.length - 1];
  const rows = (p.order as string[])
    .map((k) => ({ k, total: p.totals[k] as number }))
    .sort((a, b) => b.total - a.total);
  return `<table class="ss-scores">
    <tr><th></th>${final ? rs.map((_, i) => `<th>R${i + 1}</th>`).join('') + '<th>🍪</th>' : '<th class="l">This round</th><th>Round</th>'}<th>Total</th></tr>
    ${rows
      .map(({ k, total }) => {
        const pl = who(P, k);
        const name = `<td class="l"><span class="nm">${pl ? avatar(pl.look, 44) : ''}<b>${esc(pl?.name ?? '?')}</b></span></td>`;
        if (final) return `<tr>${name}${rs.map((r) => `<td>${r[k].total}</td>`).join('')}<td>${p.cookies?.[k] ?? 0}</td><td class="big">${total}</td></tr>`;
        return `<tr>${name}<td class="l parts">${parts(cur[k]) || '<span class="muted">nothing</span>'}</td><td>${cur[k].total}</td><td class="big">${total}</td></tr>`;
      })
      .join('')}
  </table>`;
}

let lastSig = '';

export const snackViews: GameViews = {
  host: {
    key: (c) => `${c.pub.round}:${c.pub.phase === 'pick' || c.pub.phase === 'show' ? 'play' : c.pub.phase}`,
    mount(el, c) {
      const p = c.pub;
      lastSig = '';
      if (p.phase === 'score' || p.phase === 'final' || p.phase === 'done') {
        c.sfx.fanfare();
        const final = p.phase !== 'score';
        el.innerHTML = `<div class="ss-screen">
          <h1 class="title-m">${final ? `Final spread scores <small class="ss-rate">×${POINT_RATE} to the scoreboard</small>` : `Round ${p.round} of ${ROUNDS} scores`}</h1>
          ${scoreTable(c.players, p)}
          ${!final ? `<p class="muted center">Cookies are saved in your jar until the end.</p>` : ''}
        </div>`;
        return;
      }
      if (p.round === 1) c.sfx.whoosh();
      el.innerHTML = `<div class="ss-screen">
        <div class="ss-head"><div class="ss-banner"></div>${p.round === 1 ? '' : ''}</div>
        <div class="ss-main"><div class="ss-table"></div>${legend()}</div>
      </div>`;
      snackViews.host.update!(el, c);
    },
    update(el, c) {
      const p = c.pub;
      const banner = el.querySelector('.ss-banner');
      if (!banner) return;
      const sig = JSON.stringify([p.phase, p.pick, p.done]);
      if (sig === lastSig) return;
      const prev = lastSig ? JSON.parse(lastSig) : null;
      lastSig = sig;
      if (prev) p.phase === 'show' && prev[0] !== 'show' ? c.sfx.reveal() : p.phase === 'pick' && prev[0] === 'show' ? c.sfx.whoosh() : c.sfx.lock();
      banner.innerHTML =
        p.phase === 'show'
          ? `Everyone reveals! <small>Hands pass to the ${p.dir} ${p.dir === 'left' ? '⬅️' : '➡️'}</small>`
          : `Round ${p.round} of ${ROUNDS} · Pick ${p.pick} of ${p.handLen} <small>Keep one snack on your phone, pass the rest ${p.dir}.</small>`;
      el.querySelector('.ss-table')!.innerHTML = seats(c.players, p);
    },
  },
  phone: phoneView(),
};

function phoneView(): GameViews['phone'] {
  let sel: number | null = null;
  let selKey = '';
  const view: GameViews['phone'] = {
    key: (c) => `${c.pub.pickId}:${c.pub.phase}:${c.priv?.picked ?? ''}`,
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      const me = c.me.key;
      if (pr.audience) return void (el.innerHTML = lookAtTv());
      if (selKey !== `${p.pickId}`) ((sel = null), (selKey = `${p.pickId}`));
      if (p.phase === 'score' || p.phase === 'final' || p.phase === 'done') {
        const rs = p.roundScores as Array<Record<string, Breakdown>>;
        const mine = p.phase === 'score' ? rs[rs.length - 1][me]?.total : p.totals[me];
        el.innerHTML = `<div class="screen center"><div class="result-face">🍱</div><h1 class="big">${mine ?? 0}</h1><p>${p.phase === 'score' ? `points this round` : `snack points in total`}</p><p class="muted">Look at the TV!</p></div>`;
        return;
      }
      const spread = `<div class="ss-myspread">${spreadHtml(p.spreads[me] ?? [])}</div>`;
      if (p.phase === 'show') {
        const kept = p.last?.[me] as CardId | undefined;
        el.innerHTML = `<div class="screen center">${kept ? `<div class="result-face">${card(kept).emoji}</div><h1 class="big">${card(kept).name}</h1>` : ''}<p class="muted">Passing ${p.dir}… look at the TV!</p>${spread}</div>`;
        return;
      }
      const hand = (pr.hand ?? []) as CardId[];
      if (pr.picked != null) {
        const k = hand[pr.picked];
        el.innerHTML = `<div class="screen center"><div class="result-face">${k ? card(k).emoji : '✓'}</div><h1 class="big">Kept${k ? ` ${card(k).name}` : ''}</h1><p class="muted">Waiting for everyone else…</p><button class="btn" data-undo>Change my mind</button>${spread}</div>`;
        el.querySelector('[data-undo]')!.addEventListener('click', () => {
          sel = pr.picked;
          c.send({ t: 'unpick', pick: p.pickId });
        });
        return;
      }
      const draw = () => {
        const s = sel != null ? card(hand[sel]) : null;
        el.innerHTML = `<div class="screen ss-phone">
          <p class="prompt">Keep one snack · pass the rest ${p.dir}</p>
          <div class="ss-hand n${hand.length}">${hand.map((id, i) => `<button class="ss-card ${i === sel ? 'on' : ''}" data-i="${i}"><span>${card(id).emoji}</span><small>${card(id).name}</small></button>`).join('')}</div>
          <div class="ss-rule">${s ? `<b>${s.emoji} ${s.name}</b> ${s.rule}` : '<span class="muted">Tap a snack to see what it scores.</span>'}</div>
          <button class="btn huge" data-keep ${sel == null ? 'disabled' : ''}>Keep it</button>
          ${spread}
        </div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => ((sel = Number(b.dataset.i)), draw())));
        el.querySelector('[data-keep]')!.addEventListener('click', () => sel != null && c.send({ t: 'pick', i: sel, pick: p.pickId }));
      };
      draw();
    },
  };
  return view;
}
