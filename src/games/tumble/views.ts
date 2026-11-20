import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { esc } from '../../ui/dom';
import { POINT_RATE, ROUNDS } from './logic';
import { BH, BW, EDGES, MULT, R, type Die, type Frame } from './physics';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const STEP_FILL = ['#2b2163', '#33287a', '#3d2f93', '#4a37ad'];

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
export function pips(face: number, s = R): string {
  return (PIPS[face] ?? []).map(([x, y]) => `<circle cx="${x * s * 0.5}" cy="${y * s * 0.5}" r="${s * 0.16}" fill="#120c2c"/>`).join('');
}
function dieSvg(d: { id: number; face: number; x: number; y: number }, col: string, fresh = false): string {
  return `<g class="td-die ${fresh ? 'fresh' : ''}" data-id="${d.id}" transform="translate(${d.x} ${d.y})"><rect x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" rx="12" fill="${col}" stroke="#120c2c" stroke-width="4"/><g class="pp">${pips(d.face)}</g></g>`;
}

function boardSvg(): string {
  const steps = MULT.map(
    (m, i) => `<rect x="${EDGES[i]}" y="0" width="${EDGES[i + 1] - EDGES[i]}" height="${BH}" fill="${STEP_FILL[i]}"/>
      <line x1="${EDGES[i]}" y1="0" x2="${EDGES[i]}" y2="${BH}" stroke="#120c2c" stroke-width="10"/>
      <text x="${(EDGES[i] + EDGES[i + 1]) / 2}" y="${BH / 2 + 50}" text-anchor="middle" font-size="150" font-weight="900" fill="rgba(255,255,255,.08)">×${m}</text>`,
  );
  const chevrons = [0, 1, 2, 3, 4].map((i) => `<text x="${EDGES[4] + 90}" y="${80 + i * 130}" text-anchor="middle" font-size="60" fill="rgba(255,77,109,.5)">»</text>`).join('');
  return `<svg class="td-board" viewBox="0 0 ${BW} ${BH}">
    <rect x="0" y="0" width="${EDGES[0]}" height="${BH}" fill="#1a1440"/>
    <text x="${EDGES[0] / 2}" y="${BH / 2}" text-anchor="middle" font-size="34" font-weight="800" fill="rgba(255,255,255,.25)" transform="rotate(-90 ${EDGES[0] / 2} ${BH / 2})">LAUNCH PAD</text>
    ${steps.join('')}
    <rect x="${EDGES[4]}" y="0" width="${BW - EDGES[4]}" height="${BH}" fill="#0b0820"/>${chevrons}
    <text x="${EDGES[4] + 90}" y="${BH - 20}" text-anchor="middle" font-size="26" font-weight="800" fill="rgba(255,77,109,.7)">DROP</text>
    <g class="dice"></g></svg>`;
}

let animId = 0;
let raf = 0;
let lastSig = '';

function strip(P: Player[], p: any): string {
  return (p.order as string[])
    .map((k) => {
      const pl = who(P, k);
      if (!pl) return '';
      return `<span class="td-chip ${p.turn === k && p.phase !== 'score' ? 'turn' : ''}" style="--pc:${color(pl.look)}">${avatar(pl.look, 40)}<b>${esc(pl.name)}</b><em>${p.board[k] ?? 0}</em><small>${p.totals[k] ? `${p.totals[k]} banked` : 'on board'}</small></span>`;
    })
    .join('');
}

export const tumbleViews: GameViews = {
  host: {
    key: (c) => (c.pub.phase === 'score' || c.pub.phase === 'done' ? `score:${c.pub.round}` : `play:${c.pub.round}`),
    mount(el, c) {
      const p = c.pub;
      lastSig = '';
      animId = 0;
      cancelAnimationFrame(raf);
      if (p.phase === 'score' || p.phase === 'done') {
        c.sfx.fanfare();
        const rs = p.roundScores as Array<Record<string, number>>;
        const rows = (p.order as string[]).map((k) => ({ k, t: p.totals[k] as number })).sort((a, b) => b.t - a.t);
        el.innerHTML = `<div class="td-screen">
          <h1 class="title-m">${p.round >= ROUNDS ? `Final board scores <small class="ss-rate">×${POINT_RATE} to the scoreboard</small>` : `Round ${p.round} of ${ROUNDS} scores`}</h1>
          <table class="ss-scores"><tr><th></th>${rs.map((_, i) => `<th>R${i + 1}</th>`).join('')}<th>Total</th></tr>
          ${rows.map(({ k, t }) => { const pl = who(c.players, k); return `<tr><td class="l"><span class="nm">${pl ? avatar(pl.look, 44) : ''}<b>${esc(pl?.name ?? '?')}</b></span></td>${rs.map((r) => `<td>${r[k] ?? 0}</td>`).join('')}<td class="big">${t}</td></tr>`; }).join('')}
          </table></div>`;
        return;
      }
      if (p.round === 1) c.sfx.whoosh();
      el.innerHTML = `<div class="td-screen">
        <div class="td-top"><div class="td-banner"></div><div class="td-strip"></div></div>
        <div class="td-wrap">${boardSvg()}<div class="td-rules"><b>How to play</b>On your turn, flick 2 dice from your phone: drag back, aim, let go. A die re-rolls every time it tumbles down a step. When the round ends, each die scores its face × its step. Off the end, or stuck on the launch pad, scores nothing. Knock other dice off!</div></div></div>`;
      tumbleViews.host.update!(el, c);
    },
    update(el, c) {
      const p = c.pub;
      const g = el.querySelector('.dice');
      if (!g) return;
      const colOf = (k: string) => {
        const pl = who(c.players, k);
        return pl ? color(pl.look) : '#888';
      };
      const turnName = esc(who(c.players, p.turn)?.name ?? '');
      el.querySelector('.td-banner')!.innerHTML =
        p.phase === 'roll' ? `<small>Round ${p.round} of ${ROUNDS}</small><b>${turnName}</b> flicks!` : `<small>Round ${p.round} of ${ROUNDS} · die ${p.throwNo} of 2</small><b>${turnName}</b>, flick from your phone`;
      el.querySelector('.td-rules')?.classList.toggle('hide', !(p.round === 1 && !p.dice.length && !p.anim));
      el.querySelector('.td-strip')!.innerHTML = strip(c.players, p);
      if (p.anim && p.anim.id !== animId) {
        animId = p.anim.id;
        c.sfx.whoosh();
        const owners: Record<number, string> = {};
        for (const d of p.dice as Die[]) owners[d.id] = d.owner;
        owners[p.anim.id] = p.anim.owner;
        const ids = p.anim.ids as number[];
        const frames = p.anim.frames as Frame[];
        g.innerHTML = ids.map((id, i) => dieSvg({ id, face: frames[0][i][2], x: frames[0][i][0], y: frames[0][i][1] }, colOf(owners[id] ?? ''), id === p.anim.id)).join('');
        const nodes = ids.map((id) => g.querySelector<SVGGElement>(`[data-id="${id}"]`)!);
        const faces = frames[0].map((f) => f[2]);
        const t0 = performance.now();
        const step = () => {
          const fi = Math.min(frames.length - 1, Math.floor((performance.now() - t0) / (1000 / 30)));
          frames[fi].forEach(([x, y, face, gone], i) => {
            const n = nodes[i];
            if (!n) return;
            n.setAttribute('transform', `translate(${x} ${y})`);
            n.style.opacity = gone ? '0' : '1';
            if (face !== faces[i]) {
              faces[i] = face;
              n.querySelector('.pp')!.innerHTML = pips(face);
              c.sfx.tick();
            }
          });
          if (fi < frames.length - 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        lastSig = '';
        return;
      }
      if (p.phase === 'roll') return; // animating
      const sig = JSON.stringify(p.dice);
      if (sig === lastSig) return;
      lastSig = sig;
      cancelAnimationFrame(raf);
      g.innerHTML = (p.dice as Die[]).map((d) => dieSvg(d, colOf(d.owner))).join('');
    },
  },
  phone: phoneView(),
};

/** The flick pad: a portrait mini-board. Drag back from anywhere, let go to throw. */
function flickPad(el: HTMLElement, c: PhoneViewCtx): void {
  const p = c.pub;
  el.innerHTML = `<div class="screen td-pad">
    <p class="prompt">Die ${p.throwNo} of 2 · drag back and let go</p>
    <div class="td-area"><svg viewBox="0 0 100 160" preserveAspectRatio="none" class="td-mini">
      <rect x="0" y="0" width="100" height="160" fill="#0b0820"/>
      ${MULT.map((m, i) => { const y0 = 160 - (EDGES[i + 1] / BW) * 160; const h = ((EDGES[i + 1] - EDGES[i]) / BW) * 160; return `<rect x="0" y="${y0}" width="100" height="${h}" fill="${STEP_FILL[i]}"/><text x="50" y="${y0 + h / 2 + 4}" font-size="11" text-anchor="middle" fill="rgba(255,255,255,.3)" font-weight="900">×${m}</text>`; }).join('')}
      <rect x="0" y="${160 - (EDGES[0] / BW) * 160}" width="100" height="${(EDGES[0] / BW) * 160}" fill="#1a1440"/>
    </svg>${(p.dice as Die[]).map((d) => { const pl = who(c.players, d.owner); return `<i class="td-dot" style="left:${(d.y / BH) * 100}%;bottom:${(d.x / BW) * 100}%;--dc:${pl ? color(pl.look) : '#888'}">${d.face}</i>`; }).join('')}<div class="td-ball"></div><div class="td-arrow"></div></div>
    <div class="td-power"><i></i></div>
  </div>`;
  const area = el.querySelector<HTMLElement>('.td-area')!;
  const ball = el.querySelector<HTMLElement>('.td-ball')!;
  const arrow = el.querySelector<HTMLElement>('.td-arrow')!;
  const bar = el.querySelector<HTMLElement>('.td-power i')!;
  let lane = 0.5;
  let start: { x: number; y: number } | null = null;
  let shot = { aim: 0, power: 0 };
  const place = () => {
    ball.style.left = `${lane * 100}%`;
  };
  place();
  const calc = (e: PointerEvent) => {
    const r = area.getBoundingClientRect();
    const dx = start!.x - e.clientX;
    const dy = start!.y - e.clientY; // pulling down gives a negative dy → throw up
    const len = Math.hypot(dx, dy);
    const power = Math.min(1, len / (r.height * 0.5));
    // 0 rad = straight up the phone. Clamp to ±0.5 rad.
    const ang = Math.max(-0.5, Math.min(0.5, Math.atan2(dx, -dy)));
    shot = { aim: ang / 0.5, power: -dy > 0 ? power : 0 };
    arrow.style.height = `${shot.power * 70}%`;
    arrow.style.transform = `translateX(-50%) rotate(${ang}rad)`;
    arrow.style.left = `${lane * 100}%`;
    bar.style.width = `${shot.power * 100}%`;
    bar.style.background = shot.power > 0.85 ? 'var(--bad)' : shot.power > 0.55 ? 'var(--gold)' : 'var(--good)';
  };
  area.addEventListener('pointerdown', (e) => {
    const r = area.getBoundingClientRect();
    area.setPointerCapture(e.pointerId);
    lane = Math.max(0.08, Math.min(0.92, (e.clientX - r.left) / r.width));
    place();
    start = { x: e.clientX, y: e.clientY };
    shot = { aim: 0, power: 0 };
    calc(e);
  });
  area.addEventListener('pointermove', (e) => start && calc(e));
  const release = () => {
    if (!start) return;
    start = null;
    if (shot.power < 0.04) {
      arrow.style.height = '0';
      bar.style.width = '0';
      return;
    }
    // Phone left is the TV's top rail.
    c.send({ t: 'flick', n: p.next, aim: shot.aim, power: shot.power, lane });
    el.querySelector('.prompt')!.textContent = 'Flicked! Look at the TV!';
    area.style.pointerEvents = 'none';
  };
  area.addEventListener('pointerup', release);
  area.addEventListener('pointercancel', release);
}

function phoneView(): GameViews['phone'] {
  return {
    key: (c) => `${c.pub.phase}:${c.pub.next}:${c.pub.turn === c.me.key}`,
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      if (c.priv?.audience) return void (el.innerHTML = lookAtTv());
      if (p.phase === 'aim' && p.turn === c.me.key) return flickPad(el, c);
      const mine = p.board?.[c.me.key] ?? 0;
      const name = who(c.players, p.turn)?.name ?? '';
      if (p.phase === 'score' || p.phase === 'done') return void (el.innerHTML = `<div class="screen center"><div class="result-face">🎲</div><h1 class="big">${p.totals[c.me.key] ?? 0}</h1><p>board points so far</p><p class="muted">Look at the TV!</p></div>`);
      el.innerHTML = lookAtTv('Look at the TV!', `${name} is flicking · your dice are worth ${mine}`);
    },
  };
}
