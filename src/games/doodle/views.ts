import type { GameViews, PhoneViewCtx } from '../../core/game';
import type { Player } from '../../core/room';
import { avatar, color } from '../../ui/avatars';
import { lookAtTv } from '../../ui/common';
import { sentScreen, textForm } from '../../ui/components';
import { esc } from '../../ui/dom';
import { type Entry } from './logic';
import { H, INK, MAX_POINTS, type Pt, type Stroke, W, WIDTHS, decodeStroke, encodeStroke, pointCount, toSvg } from './ink';

const who = (P: Player[], k: string | null | undefined) => P.find((p) => p.key === k);
const tag = (P: Player[], k: string) => {
  const p = who(P, k);
  return p ? `<span class="dr-by" style="--pc:${color(p.look)}">${avatar(p.look, 34)}${esc(p.name)}</span>` : '';
};

function entryCard(P: Player[], e: Entry, i: number): string {
  const body = e.kind === 'draw' ? toSvg(e.d) : `<div class="dr-guess ${e.match ? 'match' : ''}">${e.text ? `“${esc(e.text)}”` : '🤷'}${e.match ? '<i>✓</i>' : ''}</div>`;
  return `<div class="dr-card ${e.kind}" style="animation-delay:${i === -1 ? 0 : 0.05}s">${body}${tag(P, e.by)}</div>`;
}

let lastSig = '';

export const doodleViews: GameViews = {
  host: {
    key: (c) => (c.pub.phase === 'play' ? `play:${c.pub.step}` : `rev:${c.pub.revBook}`),
    mount(el, c) {
      const p = c.pub;
      lastSig = '';
      if (p.phase === 'play') {
        c.sfx.whoosh();
        const draw = p.kind === 'draw';
        el.innerHTML = `<div class="dr-screen dr-play">
          <div class="intro-badge">${draw ? '✏️' : '🤔'}</div>
          <h1 class="title-m">Step ${p.step + 1} of ${p.steps}: ${draw ? (p.step === 0 ? 'Draw your secret prompt!' : 'Draw the guess you were given!') : 'What is this drawing?'}</h1>
          <p class="small-rules">${p.step === 0 ? 'Everyone has a different prompt on their phone. No letters or numbers! Your drawing passes to the next player, who guesses it, and the guess passes on to be drawn again.' : draw ? 'Draw exactly what the last player guessed. Even if it was wrong.' : 'Write what you think this drawing is. The next player has to draw your guess.'}</p>
          <div class="dr-who"></div></div>`;
      } else {
        c.sfx.reveal();
        const owner = who(c.players, p.book.owner);
        el.innerHTML = `<div class="dr-screen">
          <div class="dr-head"><span class="kicker">Book ${p.revBook + 1} of ${p.bookCount}</span>
            <h1 class="title-m">${owner ? avatar(owner.look, 56) : ''} ${esc(owner?.name ?? '')}'s prompt: <span class="dr-prompt">${esc(p.book.prompt)}</span></h1></div>
          <div class="dr-chain"></div><div class="dr-foot"></div></div>`;
      }
      doodleViews.host.update!(el, c);
    },
    update(el, c) {
      const p = c.pub;
      if (p.phase === 'play') {
        const sig = JSON.stringify(p.sent);
        if (sig === lastSig) return;
        if (lastSig) c.sfx.lock();
        lastSig = sig;
        el.querySelector('.dr-who')!.innerHTML = (p.order as string[])
          .map((k) => {
            const pl = who(c.players, k);
            const done = p.sent.includes(k);
            return pl ? `<div class="lock-chip ${done ? 'in' : ''}" style="--pc:${color(pl.look)}">${avatar(pl.look, 56)}<span>${esc(pl.name)}</span><b>${done ? '✓' : '…'}</b></div>` : '';
          })
          .join('');
        return;
      }
      if (!p.book) return;
      const sig = `${p.revBook}:${p.revStep}`;
      if (sig === lastSig) return;
      const grew = !!lastSig;
      lastSig = sig;
      const entries = p.book.entries as Entry[];
      const chain = el.querySelector('.dr-chain')!;
      chain.className = `dr-chain n${p.steps}`;
      chain.innerHTML = entries.map((e, i) => entryCard(c.players, e, i)).join('') || '<div class="dr-wait">Here comes the chain…</div>';
      if (grew && entries.length) {
        const last = entries[entries.length - 1];
        last.match ? c.sfx.good() : c.sfx.whoosh();
      }
      const foot = el.querySelector('.dr-foot')!;
      if (p.book.perfect === true) {
        foot.innerHTML = '🎉 Perfect relay! It came all the way back. +100 to everyone in this book.';
        c.sfx.fanfare();
      } else if (p.book.perfect === false) foot.innerHTML = `It started as <b>${esc(p.book.prompt)}</b>.`;
      else foot.innerHTML = '';
    },
  },
  phone: phoneView(),
};

/** The drawing pad: canvas plus palette, sizes, undo, clear and done. */
function drawPad(el: HTMLElement, c: PhoneViewCtx, o: { title: string; text: string; step: number; onDone(d: string[]): void }): void {
  const key = `dr${o.step}`;
  let strokes: string[] = [];
  try {
    strokes = JSON.parse(c.draft.get(key) || '[]');
  } catch {
    strokes = [];
  }
  let ink = 0;
  let width = 1;
  el.innerHTML = `<div class="screen dr-pad">
    <div class="dr-task"><small>${esc(o.title)}</small><b>${esc(o.text)}</b></div>
    <div class="dr-canvas-wrap"><canvas width="${W}" height="${H}"></canvas></div>
    <div class="dr-tools">
      <div class="dr-inks">${INK.map((col, i) => `<button data-ink="${i}" style="--ink:${col}" class="${i === 0 ? 'on' : ''}" aria-label="${i === INK.length - 1 ? 'Eraser' : 'Colour'}">${i === INK.length - 1 ? '🧽' : ''}</button>`).join('')}</div>
      <div class="dr-sizes">${WIDTHS.map((w, i) => `<button data-w="${i}" class="${i === 1 ? 'on' : ''}"><i style="width:${6 + i * 7}px;height:${6 + i * 7}px"></i></button>`).join('')}
        <button data-undo aria-label="Undo">↶</button><button data-clear aria-label="Clear">🗑</button></div>
    </div>
    <button class="btn primary huge" data-done>Done</button>
  </div>`;
  const cv = el.querySelector('canvas')!;
  const g = cv.getContext('2d')!;
  const paint = (s: Stroke) => {
    g.strokeStyle = INK[s.c];
    g.lineWidth = WIDTHS[s.w];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(s.p[0][0], s.p[0][1]);
    if (s.p.length === 1) g.lineTo(s.p[0][0] + 0.1, s.p[0][1]);
    for (const q of s.p.slice(1)) g.lineTo(q[0], q[1]);
    g.stroke();
  };
  const redraw = () => {
    g.fillStyle = '#fffdf6';
    g.fillRect(0, 0, W, H);
    for (const s of strokes) {
      const d = decodeStroke(s);
      if (d) paint(d);
    }
  };
  redraw();
  let lastSent = 0;
  let pending: number | undefined;
  const save = () => {
    c.draft.set(key, JSON.stringify(strokes));
    // Keep the host up to date, so a timeout hands in what's on the page.
    clearTimeout(pending);
    const send = () => ((lastSent = Date.now()), c.send({ t: 'draft', step: o.step, d: strokes }));
    if (Date.now() - lastSent > 1500) send();
    else pending = window.setTimeout(send, 1500);
  };
  let cur: Stroke | null = null;
  const at = (e: PointerEvent): Pt => {
    const r = cv.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  };
  cv.addEventListener('pointerdown', (e) => {
    if (pointCount(strokes) >= MAX_POINTS) return;
    cv.setPointerCapture(e.pointerId);
    cur = { c: ink, w: width, p: [at(e)] };
    paint(cur);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const q = at(e);
    const last = cur.p[cur.p.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 6) return;
    if (pointCount(strokes) + cur.p.length >= MAX_POINTS) return;
    cur.p.push(q);
    g.strokeStyle = INK[cur.c];
    g.lineWidth = WIDTHS[cur.w];
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(last[0], last[1]);
    g.lineTo(q[0], q[1]);
    g.stroke();
  });
  const end = () => {
    if (!cur) return;
    strokes.push(encodeStroke(cur));
    cur = null;
    save();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  el.querySelectorAll<HTMLButtonElement>('[data-ink]').forEach((b) =>
    b.addEventListener('click', () => {
      ink = Number(b.dataset.ink);
      el.querySelectorAll('[data-ink]').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) =>
    b.addEventListener('click', () => {
      width = Number(b.dataset.w);
      el.querySelectorAll('[data-w]').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  el.querySelector('[data-undo]')!.addEventListener('click', () => (strokes.pop(), redraw(), save()));
  let clearArmed = 0;
  const clearBtn = el.querySelector<HTMLButtonElement>('[data-clear]')!;
  clearBtn.addEventListener('click', () => {
    if (Date.now() - clearArmed > 2000) {
      clearArmed = Date.now();
      clearBtn.classList.add('armed');
      setTimeout(() => clearBtn.classList.remove('armed'), 2000);
      return;
    }
    strokes = [];
    redraw();
    save();
  });
  el.querySelector('[data-done]')!.addEventListener('click', () => {
    clearTimeout(pending);
    o.onDone(strokes);
  });
}

function phoneView(): GameViews['phone'] {
  const view: GameViews['phone'] = {
    key: (c) => `${c.pub.phase}:${c.priv?.step ?? ''}:${c.priv?.sent ?? ''}`,
    mount(el, c: PhoneViewCtx) {
      const p = c.pub;
      const pr = c.priv ?? {};
      if (pr.audience) return void (el.innerHTML = lookAtTv());
      if (p.phase !== 'play') return void (el.innerHTML = lookAtTv('Look at the TV!', 'Watch the chains unravel.'));
      if (pr.sent) return void (el.innerHTML = sentScreen(pr.kind === 'draw' ? 'Drawing sent!' : 'Guess sent!', 'Waiting for the others…'));
      if (pr.kind === 'draw') {
        return drawPad(el, c, {
          title: pr.first ? 'Your secret prompt. Draw it!' : 'Draw this guess:',
          text: pr.text ?? 'Anything you like! (the guess was blank)',
          step: pr.step,
          onDone: (d) => c.send({ t: 'draw', step: pr.step, d }),
        });
      }
      let pending: number | undefined;
      textForm(el, {
        title: 'What is this?',
        above: `<div class="dr-see">${toSvg(pr.drawing)}</div>`,
        placeholder: 'Your guess',
        max: 40,
        button: 'Send guess',
        draft: {
          get: () => c.draft.get(`g${pr.step}`),
          set: (v) => {
            c.draft.set(`g${pr.step}`, v);
            clearTimeout(pending);
            pending = window.setTimeout(() => c.send({ t: 'draft', step: pr.step, text: v }), 800);
          },
        },
        onSubmit: (text) => (clearTimeout(pending), c.send({ t: 'guess', step: pr.step, text })),
      });
      el.querySelector('form')?.classList.add('dr-gform');
    },
  };
  return view;
}
