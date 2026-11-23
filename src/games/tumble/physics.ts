/**
 * A tiny top-down dice simulation for Tumble Steps. The board runs left to
 * right: a narrow launch pad, then four steps (×1 to ×4) that fan out wider
 * as they go, then the drop-off. The last step is broken up: only three
 * pockets across it pay ×4, the strips between them pay ×2.
 *
 * Dice only ever go down: each step's front edge is a wall for the dice below
 * it, so a bounce or a knock can never carry a die back up a level.
 *
 * Dice really roll: each die keeps which face is up, toward the far end and
 * toward the side, and tips over an edge for every die-width it travels, so
 * the face it ends on comes from how it moved. Rolling dice lose speed faster
 * as they slow down (they stop with a thunk instead of gliding), lose a bit
 * of speed and get knocked over when they drop down a step, bounce off the
 * slanted rails, the bumper posts and each other. Deterministic for a given rand().
 */
export const BW = 1600;
export const BH = 640;
export const R = 34;
export const LAUNCH_X = 110;
/** Step edges: [start, end) for ×1, ×2, ×3, ×4. Past the last edge = off. */
export const EDGES = [300, 640, 940, 1220, 1400];
export const MULT = [1, 2, 3, 4];
/** The board's centre line, and its half-width at the launch end and at the far end. */
export const CY = BH / 2;
export const HALF_NEAR = 150;
export const HALF_FAR = BH / 2;
const SLOPE = (HALF_FAR - HALF_NEAR) / EDGES[4];
/** Bumper posts on the ×3 step: [x, y, radius]. */
export const POSTS: Array<[number, number, number]> = [
  [1080, CY - 150, 18],
  [1080, CY + 150, 18],
];

/**
 * The ×4 step's pockets, as bands across the board: -1 is the top rail, 1 the
 * bottom rail. A die whose centre sits in a pocket scores ×4; elsewhere on
 * that step, ×2.
 */
export const POCKETS: Array<[number, number]> = [
  [-0.9, -0.56],
  [-0.17, 0.17],
  [0.56, 0.9],
];
export const GUTTER_MULT = 2;

/** Half the board's width at x: it fans out from the launch pad to the last step. */
export function halfWidth(x: number): number {
  return x >= EDGES[4] ? HALF_FAR : HALF_NEAR + Math.max(0, x) * SLOPE;
}
export const MIN_SPEED = 380;
export const MAX_SPEED = 1720;
const FRICTION = 520; // units/s²
/** Extra drag once a die is rolling slowly, so it settles instead of gliding. */
const SETTLE_DRAG = 900;
const SETTLE_SPEED = 320;
/** Distance a die travels per tip over an edge. */
export const ROLL_LEN = 2 * R * 1.2;
/** Dice touch a little before their centres are two radii apart (corners). */
const HIT_DIST = 2 * R + 6;
const RESTITUTION = 0.95;
/** Extra push for the die that gets hit. */
const KNOCK = 1.15;
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
  /** Faces pointing toward the far end (+x) and toward the bottom rail (+y). Optional for old saves. */
  east?: number;
  south?: number;
}

/**
 * Where each face points on an unrotated die (x toward the far end, y toward
 * the bottom rail, z up). Opposite faces add up to 7. Shared with the TV's 3D dice.
 */
export const FACE_NORMALS: Record<number, [number, number, number]> = {
  1: [0, 0, 1],
  6: [0, 0, -1],
  2: [1, 0, 0],
  5: [-1, 0, 0],
  3: [0, 1, 0],
  4: [0, -1, 0],
};
function faceOf(n: [number, number, number]): number {
  for (const [f, m] of Object.entries(FACE_NORMALS)) if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return Number(f);
  return 1;
}
/** The face pointing +x for a die with `top` up and `south` toward +y (x = y × z). */
export function eastOf(top: number, south: number): number {
  const a = FACE_NORMALS[south];
  const b = FACE_NORMALS[top];
  return faceOf([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
}
/** A random way up for a die. */
export function randomPose(rand: () => number): { face: number; east: number; south: number } {
  const face = 1 + Math.floor(rand() * 6);
  const sides = [1, 2, 3, 4, 5, 6].filter((f) => f !== face && f !== 7 - face);
  const south = sides[Math.floor(rand() * 4)];
  return { face, south, east: eastOf(face, south) };
}
function ensurePose(d: Die, rand: () => number): void {
  if (d.south && d.east && d.south !== d.face && d.south !== 7 - d.face) return;
  const sides = [1, 2, 3, 4, 5, 6].filter((f) => f !== d.face && f !== 7 - d.face);
  d.south = sides[Math.floor(rand() * 4)];
  d.east = eastOf(d.face, d.south);
}
/** Tip a die over one edge: +x / -x toward / away from the far end, +y / -y toward / away from the bottom rail. */
export function tip(d: Die, dir: '+x' | '-x' | '+y' | '-y'): void {
  const top = d.face;
  const e = d.east!;
  const so = d.south!;
  if (dir === '+x') ((d.face = 7 - e), (d.east = top));
  else if (dir === '-x') ((d.face = e), (d.east = 7 - top));
  else if (dir === '+y') ((d.face = 7 - so), (d.south = top));
  else ((d.face = so), (d.south = 7 - top));
}

/** Which step a point is on: -1 launch pad, 0–3 steps, 4 off the end. */
export function stepAt(x: number): number {
  if (x < EDGES[0]) return -1;
  for (let i = 0; i < 4; i++) if (x < EDGES[i + 1]) return i;
  return 4;
}

/** The multiplier under a point: 0 off the board or on the launch pad. */
export function multAt(x: number, y: number): number {
  const s = stepAt(x);
  if (s < 0 || s > 3) return 0;
  if (s < 3) return MULT[s];
  const u = (y - CY) / halfWidth(x);
  return POCKETS.some(([a, b]) => u >= a && u <= b) ? MULT[3] : GUTTER_MULT;
}

export function dieScore(d: Die): number {
  if (d.gone) return 0;
  return d.face * multAt(d.x, d.y);
}

export interface Throw {
  /** -1 (aim to the top rail) … 1 (bottom rail). */
  aim: number;
  /** 0 … 1. */
  power: number;
  /** Where on the launch line, 0 … 1 top to bottom. */
  lane: number;
}

/** Frames: per frame, per die [x, y, face, gone, east, south]. Ints to keep it small. */
export type Frame = number[][];

export function simulate(dice: Die[], thrown: Die, t: Throw, rand: () => number): { frames: Frame[]; tumbles: number; hits: number } {
  const all = [...dice, thrown];
  const v = all.map(() => ({ x: 0, y: 0 }));
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.max(0, Math.min(1, t.power));
  const ang = Math.max(-1, Math.min(1, t.aim)) * 0.5; // up to ~29°
  thrown.x = LAUNCH_X;
  thrown.y = CY + (Math.max(0, Math.min(1, t.lane)) - 0.5) * 2 * (halfWidth(LAUNCH_X) - R);
  thrown.gone = false;
  Object.assign(thrown, randomPose(rand));
  for (const d of dice) ensurePose(d, rand);
  const roll = all.map(() => ({ x: 0, y: 0 }));
  /** The lowest level each die has reached; it can't climb back above it. */
  const floor = all.map((d) => (d === thrown ? -1 : stepAt(d.x)));
  const keepDown = (i: number) => {
    const d = all[i];
    const f = floor[i];
    if (f < 0 || d.gone) return;
    const wall = EDGES[f];
    if (d.x < wall) {
      d.x = wall;
      if (v[i].x < 0) v[i].x = -v[i].x * 0.45; // bounce off the riser
    }
  };
  v[all.length - 1] = { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed };
  const frames: Frame[] = [];
  const snap = () => frames.push(all.map((d) => [Math.round(d.x), Math.round(d.y), d.face, d.gone ? 1 : 0, d.east ?? 0, d.south ?? 0]));
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
      // Roll: tip over an edge for every ROLL_LEN travelled along each axis.
      roll[i].x += v[i].x * DT;
      roll[i].y += v[i].y * DT;
      while (roll[i].x >= ROLL_LEN) ((roll[i].x -= ROLL_LEN), tip(d, '+x'));
      while (roll[i].x <= -ROLL_LEN) ((roll[i].x += ROLL_LEN), tip(d, '-x'));
      while (roll[i].y >= ROLL_LEN) ((roll[i].y -= ROLL_LEN), tip(d, '+y'));
      while (roll[i].y <= -ROLL_LEN) ((roll[i].y += ROLL_LEN), tip(d, '-y'));
      const drag = FRICTION + (sp < SETTLE_SPEED ? SETTLE_DRAG : 0);
      const k = Math.max(0, sp - drag * DT) / sp;
      v[i].x *= k;
      v[i].y *= k;
      const after = stepAt(d.x);
      if (after > floor[i]) floor[i] = Math.min(after, 3);
      keepDown(i);
      if (after !== before && after > before) {
        if (after === 4) {
          d.gone = true;
          v[i] = { x: 0, y: 0 };
          continue;
        }
        // Tumble down a step: the landing knocks it over once or twice in a
        // random direction, takes some speed off and scatters it sideways.
        const flips = 1 + Math.floor(rand() * 2);
        for (let f = 0; f < flips; f++) tip(d, (['+x', '-x', '+y', '-y'] as const)[Math.floor(rand() * 4)]);
        v[i].x *= 0.86;
        v[i].y = v[i].y * 0.86 + (rand() - 0.5) * 160;
        tumbles++;
      }
      // Slanted side rails: push back inside and bounce off the rail's normal.
      const s = d.x >= EDGES[4] ? 0 : SLOPE;
      const norm = Math.hypot(s, 1);
      for (const side of [-1, 1]) {
        const n = { x: s / norm, y: -side / norm }; // points into the board
        const edgeY = CY + side * halfWidth(d.x);
        const dist = ((d.y - edgeY) * -side) / norm;
        if (dist < R) {
          d.x += n.x * (R - dist);
          d.y += n.y * (R - dist);
          const vn = v[i].x * n.x + v[i].y * n.y;
          if (vn < 0) {
            v[i].x -= 1.6 * vn * n.x;
            v[i].y -= 1.6 * vn * n.y;
          }
        }
      }
      // Bumper posts.
      for (const [px, py, pr] of POSTS) {
        const dx = d.x - px;
        const dy = d.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist >= R + pr || dist === 0) continue;
        const n = { x: dx / dist, y: dy / dist };
        d.x = px + n.x * (R + pr);
        d.y = py + n.y * (R + pr);
        const vn = v[i].x * n.x + v[i].y * n.y;
        if (vn < 0) {
          v[i].x -= 1.8 * vn * n.x;
          v[i].y -= 1.8 * vn * n.y;
          hits++;
        }
      }
      // The back wall of the launch pad.
      if (d.x < R) ((d.x = R), (v[i].x = Math.abs(v[i].x) * 0.5));
      keepDown(i);
    }
    // Collisions between dice.
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.gone || b.gone) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= HIT_DIST || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = HIT_DIST - dist;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        keepDown(i);
        keepDown(j);
        const rel = (v[i].x - v[j].x) * nx + (v[i].y - v[j].y) * ny;
        if (rel <= 0) continue;
        // Hard dice clack: nearly elastic, and the die that's hit gets a
        // little extra shove (dice bounce off corners, not like pucks).
        const imp = (rel * (1 + RESTITUTION)) / 2;
        const iHit = Math.hypot(v[i].x, v[i].y) < Math.hypot(v[j].x, v[j].y);
        v[i].x -= imp * nx * (iHit ? KNOCK : 1);
        v[i].y -= imp * ny * (iHit ? KNOCK : 1);
        v[j].x += imp * nx * (iHit ? 1 : KNOCK);
        v[j].y += imp * ny * (iHit ? 1 : KNOCK);
        // A hard hit knocks both dice over.
        if (rel > 260) {
          const dir = (n: number, m: number) => (Math.abs(n) > Math.abs(m) ? (n > 0 ? '+x' : '-x') : m > 0 ? '+y' : '-y');
          tip(b, dir(nx, ny));
          tip(a, dir(-nx, -ny));
        }
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
