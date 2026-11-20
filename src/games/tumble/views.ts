import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { esc } from '../../ui/dom';
import { DICE_EACH, POINT_RATE, ROUNDS } from './logic';
import { BH, BW, CY, EDGES, HALF_FAR, HALF_NEAR, LAUNCH_X, MULT, POSTS, R, type Die, type Frame, halfWidth, stepAt } from './physics';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
/** Step colours (surface, side face), launch pad first. */
const STEP_FILL: Array<[string, string]> = [
  ['#2a2350', '#141030'],
  ['#21b8a8', '#0f6e65'],
  ['#3b82f6', '#1d4c9c'],
  ['#8b5cf6', '#55309f'],
  ['#ec4899', '#9a2463'],
];
/** How far each step sits "below" the one before it, in board units. */
const DROP = 18;
const THICK = 40;
/** Visual offset for a point's step: lower steps are drawn further down. */
export const lift = (x: number) => (stepAt(x) + 1) * DROP;

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
  return `<g class="td-die ${fresh ? 'fresh' : ''}" data-id="${d.id}" transform="translate(${d.x} ${d.y + lift(d.x)})">
    <ellipse class="sh" cx="6" cy="${R * 0.9}" rx="${R * 1.1}" ry="${R * 0.45}" fill="rgba(0,0,0,.4)"/>
    <g class="bob"><g class="spin"><rect x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" rx="13" fill="${col}" stroke="#120c2c" stroke-width="4"/>
    <rect x="${-R + 6}" y="${-R + 5}" width="${2 * R - 12}" height="${R * 0.55}" rx="8" fill="rgba(255,255,255,.28)"/><g class="pp">${pips(d.face)}</g></g></g></g>`;
}

/** One slice of the board between x0 and x1: top surface and the side face below it. */
function slab(x0: number, x1: number, o: number, fill: [string, string], id: string): string {
  const t0 = CY - halfWidth(x0) + o;
  const t1 = CY - halfWidth(x1) + o;
  const b0 = CY + halfWidth(x0) + o;
  const b1 = CY + halfWidth(x1) + o;
  return `<polygon points="${x0},${b0} ${x1},${b1} ${x1},${b1 + THICK} ${x0},${b0 + THICK}" fill="${fill[1]}"/>
    <polygon points="${x1},${t1} ${x1},${b1} ${x1},${b1 + THICK} ${x1},${t1}" fill="${fill[1]}"/>
    <polygon points="${x0},${t0} ${x1},${t1} ${x1},${b1} ${x0},${b0}" fill="url(#${id})" stroke="rgba(255,255,255,.18)" stroke-width="3"/>`;
}

function boardSvg(): string {
  const xs = [0, ...EDGES];
  // Draw the lowest (furthest) step first so higher steps sit on top of it.
  const parts: string[] = [];
  const grads: string[] = [];
  for (let k = 4; k >= 0; k--) {
    const id = `tdg${k}`;
    const [top] = STEP_FILL[k];
    grads.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${top}" stop-opacity=".78"/><stop offset=".15" stop-color="${top}"/><stop offset="1" stop-color="${top}"/></linearGradient>`);
    parts.push(slab(xs[k], xs[k + 1], k * DROP, STEP_FILL[k], id));
  }
  const labels = MULT.map((m, i) => {
    const x = (EDGES[i] + EDGES[i + 1]) / 2;
    return `<text x="${x}" y="${CY + 52 + (i + 1) * DROP}" text-anchor="middle" font-size="${120 + i * 14}" font-weight="900" fill="rgba(255,255,255,.2)">×${m}</text>`;
  }).join('');
  const posts = POSTS.map(([x, y, r]) => {
    const o = lift(x);
    return `<ellipse cx="${x + 6}" cy="${y + o + r}" rx="${r * 1.3}" ry="${r * 0.6}" fill="rgba(0,0,0,.45)"/>
      <rect x="${x - r}" y="${y + o - r * 2.2}" width="${r * 2}" height="${r * 2.2}" fill="#e8e3f7"/>
      <ellipse cx="${x}" cy="${y + o}" rx="${r}" ry="${r * 0.55}" fill="#bdb4dd"/>
      <ellipse class="post-top" cx="${x}" cy="${y + o - r * 2.2}" rx="${r}" ry="${r * 0.55}" fill="#fff"/>`;
  }).join('');
  const lx = EDGES[4] + 70;
  const chevrons = [-2, -1, 0, 1, 2].map((i) => `<text class="chev" x="${lx}" y="${CY + i * 120 + 20 + 4 * DROP}" text-anchor="middle" font-size="64" fill="#ff4d6d" style="animation-delay:${Math.abs(i) * 0.15}s">»</text>`).join('');
  return `<svg class="td-board" viewBox="-30 -24 ${BW + 60} ${BH + 4 * DROP + THICK + 70}">
    <defs>${grads.join('')}
      <radialGradient id="tdvoid" cx="0" cy=".5" r="1"><stop offset="0" stop-color="#ff4d6d" stop-opacity=".35"/><stop offset=".7" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient>
      <filter id="tdblur"><feGaussianBlur stdDeviation="18"/></filter>
      <pattern id="tdstripe" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="24" fill="rgba(255,209,102,.16)"/></pattern></defs>
    <polygon points="20,${CY - HALF_NEAR + 90} ${EDGES[4]},${CY - HALF_FAR + 120} ${EDGES[4]},${CY + HALF_FAR + 160} 20,${CY + HALF_NEAR + 140}" fill="rgba(0,0,0,.55)" filter="url(#tdblur)"/>
    <rect x="${EDGES[4]}" y="-40" width="${BW - EDGES[4] + 40}" height="${BH + 200}" fill="url(#tdvoid)"/>
    ${chevrons}<text x="${lx}" y="${BH + 4 * DROP + 70}" text-anchor="middle" font-size="30" font-weight="900" fill="#ff4d6d" letter-spacing="4">DROP</text>
    ${parts.join('')}
    <polygon points="0,${CY - HALF_NEAR} ${EDGES[0]},${CY - halfWidth(EDGES[0])} ${EDGES[0]},${CY + halfWidth(EDGES[0])} 0,${CY + HALF_NEAR}" fill="url(#tdstripe)"/>
    <text x="${EDGES[0] / 2}" y="${CY}" text-anchor="middle" dominant-baseline="middle" font-size="30" font-weight="900" letter-spacing="3" fill="rgba(255,209,102,.6)" transform="rotate(-90 ${EDGES[0] / 2} ${CY})">LAUNCH</text>
    ${labels}${posts}
    <g class="dice"></g></svg>`;
}

let animId = 0;
let raf = 0;
let lastSig = '';

const dots = (n: number) => (n > 0 ? `${n} ${n === 1 ? 'die' : 'dice'} left` : 'all thrown');

function strip(P: Player[], p: any): string {
  return (p.order as string[])
    .map((k) => {
      const pl = who(P, k);
      if (!pl) return '';
      return `<span class="td-chip ${p.turn === k && p.phase !== 'score' ? 'turn' : ''}" style="--pc:${color(pl.look)}">${avatar(pl.look, 40)}<b>${esc(pl.name)}</b><em>${p.board[k] ?? 0}</em><small>${dots(p.left?.[k] ?? 0)}</small></span>`;
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
          <table class="ss-scores"><tr><th></th>${rs.length > 1 ? rs.map((_, i) => `<th>R${i + 1}</th>`).join('') : ''}<th>Total</th></tr>
          ${rows.map(({ k, t }) => { const pl = who(c.players, k); return `<tr><td class="l"><span class="nm">${pl ? avatar(pl.look, 44) : ''}<b>${esc(pl?.name ?? '?')}</b></span></td>${rs.length > 1 ? rs.map((r) => `<td>${r[k] ?? 0}</td>`).join('') : ''}<td class="big">${t}</td></tr>`; }).join('')}
          </table></div>`;
        return;
      }
      if (p.round === 1) c.sfx.whoosh();
      el.innerHTML = `<div class="td-screen">
        <div class="td-top"><div class="td-banner"></div><div class="td-strip"></div></div>
        <div class="td-wrap">${boardSvg()}<div class="td-rules"><b>How to play</b>Everyone has ${DICE_EACH} dice. Take turns flicking one at a time from your phone: drag back, aim, let go. A die re-rolls every time it tumbles down a step. When everyone is out of dice, each die scores its face × its step. Off the end, or stuck on the launch pad, scores nothing. Knock other dice off!</div></div></div>`;
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
        p.phase === 'roll' ? `<small>Die ${p.throwNo} of ${DICE_EACH}</small><b>${turnName}</b> flicks!` : `<small>Die ${p.throwNo} of ${DICE_EACH}</small><b>${turnName}</b>, flick from your phone`;
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
        const steps = frames[0].map((f) => stepAt(f[0]));
        const spin = frames[0].map(() => 0);
        const last = frames[0].map((f) => [f[0], f[1]]);
        const fell = frames[0].map(() => false);
        const t0 = performance.now();
        const FR = 1000 / 30;
        const step = () => {
          const t = (performance.now() - t0) / FR;
          const fi = Math.min(frames.length - 1, Math.floor(t));
          const nx = Math.min(frames.length - 1, fi + 1);
          const k = Math.min(1, t - fi);
          frames[fi].forEach(([x0, y0, face, gone], i) => {
            const n = nodes[i];
            if (!n) return;
            const [x1, y1] = frames[nx][i];
            const x = x0 + (x1 - x0) * k;
            const y = y0 + (y1 - y0) * k;
            // Spin with the distance travelled, so a sliding die looks like it's tumbling.
            spin[i] += Math.hypot(x - last[i][0], y - last[i][1]) * 0.9 * (i % 2 ? 1 : -1);
            last[i] = [x, y];
            n.setAttribute('transform', `translate(${x} ${y + lift(x)})`);
            n.querySelector('.spin')!.setAttribute('transform', `rotate(${spin[i] % 360})`);
            const st = stepAt(x);
            if (st !== steps[i] && st > steps[i] && st < 4) {
              const b = n.querySelector('.bob')!;
              b.classList.remove('drop');
              void (b as SVGGElement).getBoundingClientRect();
              b.classList.add('drop');
            }
            steps[i] = st;
            if (gone && !fell[i]) {
              fell[i] = true;
              n.classList.add(x >= EDGES[4] ? 'fall' : 'fade');
              if (x >= EDGES[4]) c.sfx.bad();
            }
            if (face !== faces[i]) {
              faces[i] = face;
              n.querySelector('.pp')!.innerHTML = pips(face);
              c.sfx.tick();
            }
          });
          if (t < frames.length - 1) raf = requestAnimationFrame(step);
          else nodes.forEach((n) => n?.querySelector('.spin')?.setAttribute('transform', 'rotate(0)'));
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
/** A board point on the portrait mini-board (launch at the bottom): side -1 top rail, 1 bottom rail. */
function miniPt(x: number, side: number): string {
  return `${((CY + side * halfWidth(x)) / BH) * 100},${160 - (x / BW) * 160}`;
}
/** Where a launch lane (0–1) sits across the phone, as a fraction of its width. */
const laneX = (lane: number) => (CY + (lane - 0.5) * 2 * (halfWidth(LAUNCH_X) - R)) / BH;

function flickPad(el: HTMLElement, c: PhoneViewCtx): void {
  const p = c.pub;
  el.innerHTML = `<div class="screen td-pad">
    <p class="prompt">Die ${p.throwNo} of ${DICE_EACH} · drag back and let go</p>
    <div class="td-area"><svg viewBox="0 0 100 160" preserveAspectRatio="none" class="td-mini">
      <rect x="0" y="0" width="100" height="160" fill="#0b0820"/>
      <rect x="0" y="0" width="100" height="${(1 - EDGES[4] / BW) * 160}" fill="rgba(255,77,109,.18)"/>
      ${[0, ...EDGES].slice(0, 5).map((x0, k) => { const x1 = EDGES[k]; return `<polygon points="${miniPt(x0, -1)} ${miniPt(x1, -1)} ${miniPt(x1, 1)} ${miniPt(x0, 1)}" fill="${STEP_FILL[k][0]}" stroke="rgba(255,255,255,.25)" stroke-width=".6" vector-effect="non-scaling-stroke"/>`; }).join('')}
      ${MULT.map((m, i) => `<text x="50" y="${160 - ((EDGES[i] + EDGES[i + 1]) / 2 / BW) * 160 + 4}" font-size="11" text-anchor="middle" fill="rgba(255,255,255,.4)" font-weight="900">×${m}</text>`).join('')}
      ${POSTS.map(([x, y]) => `<circle cx="${(y / BH) * 100}" cy="${160 - (x / BW) * 160}" r="2.2" fill="#fff"/>`).join('')}
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
    ball.style.left = `${laneX(lane) * 100}%`;
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
    arrow.style.left = `${laneX(lane) * 100}%`;
    bar.style.width = `${shot.power * 100}%`;
    bar.style.background = shot.power > 0.85 ? 'var(--bad)' : shot.power > 0.55 ? 'var(--gold)' : 'var(--good)';
  };
  area.addEventListener('pointerdown', (e) => {
    const r = area.getBoundingClientRect();
    area.setPointerCapture(e.pointerId);
    // Touch anywhere: the die starts at the matching spot across the launch pad.
    const lo = laneX(0);
    const hi = laneX(1);
    const fx = (e.clientX - r.left) / r.width;
    lane = Math.max(0, Math.min(1, (fx - Math.min(lo, 0.12)) / (Math.max(hi, 0.88) - Math.min(lo, 0.12))));
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
