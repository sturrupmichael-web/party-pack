/**
 * Real 3D dice for the TV, drawn in SVG. Each die is a cube with an
 * orientation (a quaternion). Every frame we rotate its six faces, keep the
 * ones facing the camera, and map a flat face (rounded square + pips) onto
 * each with an affine transform. Rolling turns the cube 90° per ROLL_LEN
 * travelled (the same rate the physics uses to tip it), and the cube is
 * steered toward the pose the physics reports so it always lands on the
 * right face.
 */
import { FACE_NORMALS, R, ROLL_LEN, eastOf } from './physics';

type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // w, x, y, z

const H = R * 0.92;
/** Camera: looking down at the board from the near (bottom) edge. */
const TILT = (38 * Math.PI) / 180;
const VIEW: V3 = [0, Math.sin(TILT), Math.cos(TILT)];
const LIGHT: V3 = norm([-0.35, -0.25, 1]);

function norm(v: V3): V3 {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
export function qaxis(axis: V3, ang: number): Quat {
  const [x, y, z] = norm(axis);
  const s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), x * s, y * s, z * s];
}
function qnorm(q: Quat): Quat {
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
export function rot(q: Quat, v: V3): V3 {
  const [w, x, y, z] = q;
  const t = cross([x, y, z], v).map((c) => 2 * c) as V3;
  const u = cross([x, y, z], t);
  return [v[0] + w * t[0] + u[0], v[1] + w * t[1] + u[1], v[2] + w * t[2] + u[2]];
}
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) ((b = b.map((c) => -c) as Quat), (d = -d));
  if (d > 0.9995) return qnorm(a.map((c, i) => c + (b[i] - c) * t) as Quat);
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s;
  const kb = Math.sin(t * th) / s;
  return qnorm(a.map((c, i) => c * ka + b[i] * kb) as Quat);
}

/** The exact orientation for a physics pose: `top` up, `east` toward +x, `south` toward +y. */
export function poseQuat(top: number, east?: number, south?: number): Quat {
  if (!south || south === top || south === 7 - top) south = [1, 2, 3, 4, 5, 6].find((f) => f !== top && f !== 7 - top)!;
  east = eastOf(top, south);
  // Rotation matrix rows: world x, y, z = body normals of east, south, top.
  const e = FACE_NORMALS[east];
  const s = FACE_NORMALS[south];
  const t = FACE_NORMALS[top];
  const m = [e, s, t]; // m[row][col]
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q: Quat;
  if (tr > 0) {
    const k = Math.sqrt(tr + 1) * 2;
    q = [k / 4, (m[2][1] - m[1][2]) / k, (m[0][2] - m[2][0]) / k, (m[1][0] - m[0][1]) / k];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const k = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / k, k / 4, (m[0][1] + m[1][0]) / k, (m[0][2] + m[2][0]) / k];
  } else if (m[1][1] > m[2][2]) {
    const k = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / k, (m[0][1] + m[1][0]) / k, k / 4, (m[1][2] + m[2][1]) / k];
  } else {
    const k = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / k, (m[0][2] + m[2][0]) / k, (m[1][2] + m[2][1]) / k, k / 4];
  }
  return qnorm(q);
}

/** Turn a die rolling (dx, dy): 90° per ROLL_LEN, about the axis across its path. */
export function rollBy(q: Quat, dx: number, dy: number): Quat {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return q;
  return qnorm(qmul(qaxis([-dy, dx, 0], (d / ROLL_LEN) * (Math.PI / 2)), q));
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
/** Each face's in-plane axes on the unrotated die. */
const FACE_AXES: Record<number, [V3, V3]> = {};
for (const [f, n] of Object.entries(FACE_NORMALS)) {
  const u: V3 = Math.abs(n[2]) === 1 ? [1, 0, 0] : [0, 0, 1];
  FACE_AXES[Number(f)] = [u, cross(n as V3, u)];
}

/** The SVG for one die: shadow, then six (hidden until drawn) faces. */
export function cubeSvg(col: string): string {
  const faces = [1, 2, 3, 4, 5, 6]
    .map(
      (f) =>
        `<g class="cf" data-f="${f}" style="display:none"><rect x="-1" y="-1" width="2" height="2" rx=".32" fill="${col}"/><rect class="shade" x="-1" y="-1" width="2" height="2" rx=".32" fill="#000"/>` +
        PIPS[f].map(([x, y]) => `<circle cx="${x * 0.5}" cy="${y * 0.5}" r=".19" fill="${f === 1 ? '#120c2c' : '#120c2c'}"/>`).join('') +
        `<rect x="-1" y="-1" width="2" height="2" rx=".32" fill="none" stroke="#120c2c" stroke-width="4" vector-effect="non-scaling-stroke"/></g>`,
    )
    .join('');
  return `<ellipse class="sh" cx="6" cy="${H * 0.95}" rx="${H * 1.25}" ry="${H * 0.5}" fill="rgba(0,0,0,.42)"/><g class="cube">${faces}</g>`;
}

const project = (v: V3): [number, number] => [v[0], v[1] * Math.cos(TILT) - v[2] * Math.sin(TILT)];

/** Draw a cube (made by cubeSvg) in orientation q. */
export function drawCube(cube: SVGGElement, q: Quat): void {
  const shown: Array<[number, SVGGElement]> = [];
  for (const g of Array.from(cube.children) as SVGGElement[]) {
    const f = Number(g.dataset.f);
    const n = rot(q, FACE_NORMALS[f] as V3);
    const facing = dot(n, VIEW);
    if (facing <= 0.02) {
      g.style.display = 'none';
      continue;
    }
    const [ub, vb] = FACE_AXES[f];
    const c = project(n.map((k) => k * H) as V3);
    const u = project(rot(q, ub).map((k) => k * H) as V3);
    const v = project(rot(q, vb).map((k) => k * H) as V3);
    g.setAttribute('transform', `matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${c[0]} ${c[1]})`);
    const lit = Math.max(0, dot(n, LIGHT));
    (g.querySelector('.shade') as SVGElement).setAttribute('opacity', String(Math.min(0.55, 0.62 - lit * 0.62).toFixed(2)));
    g.style.display = '';
    shown.push([facing, g]);
  }
  // Faces nearer the camera last.
  shown.sort((a, b) => a[0] - b[0]).forEach(([, g]) => cube.appendChild(g));
}

/** A settled die's resting pose, with a fixed little twist so a board of dice doesn't look gridded. */
export function restQuat(face: number, east: number | undefined, south: number | undefined, id: number): Quat {
  const twist = (((id * 37) % 21) - 10) * 0.025;
  return qnorm(qmul(qaxis([0, 0, 1], twist), poseQuat(face, east, south)));
}
