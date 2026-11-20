/**
 * Site-wide "who's playing" presence.
 *
 * Every game page on michaelsturrup.com joins the Supabase Realtime presence
 * channel `site:presence` and tracks `{ g: <game slug>, r: <role> }`. Anyone
 * subscribed (the site's homepage, the stats page) sees the live list and can
 * count people per game. No database: presence lives only in Realtime memory
 * and an entry vanishes when its tab closes.
 *
 * It also bumps the shared visit counter (table public.site_visits via the
 * record_visit RPC) once per tab session.
 *
 * Role: 'host' is a shared TV screen, not a person, so counts skip it.
 */
import { supabaseClient } from './transport';

export const PRESENCE_CHANNEL = 'site:presence';
export const GAME_SLUG = 'party-pack';

export type Role = 'host' | 'phone';

export interface PresenceMeta {
  g: string;
  r: string;
}

/** People per game from a presence state; host screens aren't people. */
export function countPlayers(state: Record<string, PresenceMeta[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metas of Object.values(state)) {
    const m = metas[0];
    if (!m || typeof m.g !== 'string' || m.r === 'host') continue;
    out[m.g] = (out[m.g] ?? 0) + 1;
  }
  return out;
}

let current: { setRole(r: Role): void } | null = null;
let lastCount: number | null = null;
const listeners = new Set<(n: number) => void>();

/** Live count of people on this game (including you). Returns an unsubscribe. */
export function onPlayerCount(cb: (n: number) => void): () => void {
  listeners.add(cb);
  if (lastCount !== null) cb(lastCount);
  return () => listeners.delete(cb);
}

/** Start (or update) this tab's presence. Safe to call repeatedly; no-op offline. */
export function trackPresence(role: Role): void {
  if (current) return current.setRole(role);
  const client = supabaseClient();
  if (!client) return;
  recordVisit();
  const key = Math.random().toString(36).slice(2, 12);
  const channel = client.channel(PRESENCE_CHANNEL, { config: { presence: { key } } });
  let meta: PresenceMeta = { g: GAME_SLUG, r: role };
  let joined = false;
  channel.on('presence', { event: 'sync' }, () => {
    lastCount = countPlayers(channel.presenceState<PresenceMeta>() as Record<string, PresenceMeta[]>)[GAME_SLUG] ?? 0;
    listeners.forEach((cb) => cb(lastCount!));
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      joined = true;
      void channel.track(meta);
    }
  });
  current = {
    setRole(r) {
      if (meta.r === r) return;
      meta = { g: GAME_SLUG, r };
      if (joined) void channel.track(meta);
    },
  };
}

/** +1 on the site visit counter, once per browser tab session. */
function recordVisit(): void {
  try {
    const k = `michaelsturrup.visit.${GAME_SLUG}`;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
  } catch {
    /* storage blocked: still count */
  }
  // supabase-js builders are lazy: the request only goes out once it's awaited/then'd.
  supabaseClient()
    ?.rpc('record_visit', { p_page: GAME_SLUG })
    .then(
      () => {},
      () => {},
    );
}
