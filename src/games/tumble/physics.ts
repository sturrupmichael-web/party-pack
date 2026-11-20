/**
 * A tiny top-down dice simulation for Tumble Steps. The board runs left to
 * right: a launch pad, then four steps (×1 to ×4), then the drop-off. Dice
 * slide with friction, bounce off the side rails and each other, and re-roll
 * whenever they tumble down a step. Deterministic for a given rand().
 */
export const BW = 1600;
export const BH = 640;
export const R = 34;
export const LAUNCH_X = 110;
/** Step edges: [start, end) for ×1, ×2, ×3, ×4. Past the last edge = off. */
export const EDGES = [300, 640, 940, 1200, 1420];
export const MULT = [1, 2, 3, 4];
export const MIN_SPEED = 380;
export const MAX_SPEED = 1500;
const FRICTION = 640; // units/s²
const DT = 1 / 120;
const FRAME_EVERY = 4; // 30 fps keyframes

export interface Die {
  id: number;
  owner: string;
  face: number;
  x: number;
  y: number;
  /** Off the board (fell off the end, or never made it to the first step). */
  gone: boolean;
}

/** Which step a point is on: -1 launch pad, 0–3 steps, 4 off the end. */
export function stepAt(x: number): number {
  if (x < EDGES[0]) return -1;
  for (let i = 0; i < 4; i++) if (x < EDGES[i + 1]) return i;
  return 4;
}

export function dieScore(d: Die): number {
  if (d.gone) return 0;
  const s = stepAt(d.x);
  return s >= 0 && s < 4 ? d.face * MULT[s] : 0;
}

export interface Throw {
  /** -1 (aim to the top rail) … 1 (bottom rail). */
  aim: number;
  /** 0 … 1. */
  power: number;
  /** Where on the launch line, 0 … 1 top to bottom. */
  lane: number;
}

/** Frames: per frame, per die [x, y, face, gone]. Ints to keep it small. */
export type Frame = number[][];

export function simulate(dice: Die[], thrown: Die, t: Throw, rand: () => number): { frames: Frame[]; tumbles: number; hits: number } {
  const all = [...dice, thrown];
  const v = all.map(() => ({ x: 0, y: 0 }));
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.max(0, Math.min(1, t.power));
  const ang = Math.max(-1, Math.min(1, t.aim)) * 0.5; // up to ~29°
  thrown.x = LAUNCH_X;
  thrown.y = R + (BH - 2 * R) * Math.max(0, Math.min(1, t.lane));
  thrown.gone = false;
  v[all.length - 1] = { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed };
  const frames: Frame[] = [];
  const snap = () => frames.push(all.map((d) => [Math.round(d.x), Math.round(d.y), d.face, d.gone ? 1 : 0]));
  snap();
  let tumbles = 0;
  let hits = 0;
  for (let n = 1; n < 120 * 12; n++) {
    let moving = false;
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      if (d.gone) continue;
      const sp = Math.hypot(v[i].x, v[i].y);
      if (sp < 1) {
        v[i] = { x: 0, y: 0 };
        continue;
      }
      moving = true;
      const before = stepAt(d.x);
      d.x += v[i].x * DT;
      d.y += v[i].y * DT;
      const k = Math.max(0, sp - FRICTION * DT) / sp;
      v[i].x *= k;
      v[i].y *= k;
      const after = stepAt(d.x);
      if (after !== before && after > before) {
        if (after === 4) {
          d.gone = true;
          v[i] = { x: 0, y: 0 };
          continue;
        }
        // Tumble down a step: new face, a little scatter.
        d.face = 1 + Math.floor(rand() * 6);
        v[i].y += (rand() - 0.5) * 120;
        tumbles++;
      }
      // Side rails.
      if (d.y < R) ((d.y = R), (v[i].y = Math.abs(v[i].y) * 0.6));
      if (d.y > BH - R) ((d.y = BH - R), (v[i].y = -Math.abs(v[i].y) * 0.6));
      // The back wall of the launch pad.
      if (d.x < R) ((d.x = R), (v[i].x = Math.abs(v[i].x) * 0.5));
    }
    // Collisions (equal masses, a bit of energy lost).
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.gone || b.gone) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= 2 * R || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = 2 * R - dist;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        const rel = (v[i].x - v[j].x) * nx + (v[i].y - v[j].y) * ny;
        if (rel <= 0) continue;
        const imp = rel * 0.9;
        v[i].x -= imp * nx;
        v[i].y -= imp * ny;
        v[j].x += imp * nx;
        v[j].y += imp * ny;
        hits++;
        moving = true;
      }
    if (n % FRAME_EVERY === 0) snap();
    if (!moving) break;
  }
  // A die that never reached the first step doesn't count and is cleared.
  for (const d of all) if (!d.gone && stepAt(d.x) < 0) d.gone = true;
  snap();
  return { frames, tumbles, hits };
}
