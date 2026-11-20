export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Fit a fixed 1920×1080 stage into the window, letterboxed. */
export function fitStage(stage: HTMLElement, w = 1920, h = 1080): void {
  const fit = () => {
    const k = Math.min(window.innerWidth / w, window.innerHeight / h);
    stage.style.transform = `translate(${(window.innerWidth - w * k) / 2}px, ${(window.innerHeight - h * k) / 2}px) scale(${k})`;
  };
  window.addEventListener('resize', fit);
  fit();
}

/** A tiny try/catch wrapper around localStorage. */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
