/**
 * Realtime transport (adapted from Crokinole). Production uses one Supabase
 * Realtime broadcast channel per room code. When the Supabase env vars are
 * missing (local dev / tests) it falls back to the browser's BroadcastChannel,
 * which connects tabs of the same browser, so a host and several "phone" tabs
 * can run on one laptop.
 *
 * Every message travels as one broadcast event named "m" whose payload is a
 * typed Wire message ({ v, type, from, payload, ts }, see core/protocol.ts).
 *
 * The host also tracks Supabase Presence on its room channel as { r: 'host' }.
 * That lets a new host check that nobody else is hosting a code before it
 * claims it, and lets the room disappear when the host's tab goes away.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Wire } from '../core/protocol';

export type Handler = (msg: Wire) => void;

export interface Transport {
  readonly kind: 'supabase' | 'local';
  ready: Promise<void>;
  send(msg: Wire): void;
  on(cb: Handler): void;
  /** Host only: number of *other* hosts present on this room channel (0 offline). */
  otherHosts(): Promise<number>;
  close(): void;
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function hasSupabase(): boolean {
  return !!(URL && KEY);
}

export function channelName(room: string): string {
  return `partypack:${room}`;
}

export function createTransport(room: string, opts: { host?: boolean } = {}): Transport {
  return hasSupabase() ? supabaseTransport(room, !!opts.host) : localTransport(room);
}

/** One shared Supabase client per page (null without env vars). */
export function supabaseClient(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  client ??= createClient(URL!, KEY!, {
    realtime: { params: { eventsPerSecond: 20 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function supabaseTransport(room: string, host: boolean): Transport {
  const client = supabaseClient()!;
  const handlers: Handler[] = [];
  const presenceKey = Math.random().toString(36).slice(2, 12);
  const channel: RealtimeChannel = client.channel(channelName(room), {
    config: { broadcast: { self: false, ack: false }, ...(host ? { presence: { key: presenceKey } } : {}) },
  });
  channel.on('broadcast', { event: 'm' }, (msg: { payload: Wire }) => {
    if (msg.payload && typeof msg.payload === 'object') handlers.forEach((h) => h(msg.payload));
  });
  let synced!: () => void;
  const presenceSynced = new Promise<void>((r) => (synced = r));
  if (host) channel.on('presence', { event: 'sync' }, () => synced());
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolveReady();
  });
  return {
    kind: 'supabase',
    ready,
    send(msg) {
      void channel.send({ type: 'broadcast', event: 'm', payload: msg });
    },
    on(cb) {
      handlers.push(cb);
    },
    async otherHosts() {
      if (!host) return 0;
      // If Realtime is slow or blocked, don't hold the TV hostage: carry on after a few seconds.
      const ok = await Promise.race([ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]);
      if (!ok) {
        void ready.then(() => channel.track({ r: 'host' }));
        return 0;
      }
      // Presence sync normally arrives right after subscribing; don't wait forever.
      await Promise.race([presenceSynced, new Promise((r) => setTimeout(r, 2000))]);
      const state = channel.presenceState<{ r: string }>();
      const others = Object.entries(state).filter(([k, metas]) => k !== presenceKey && metas.some((m) => m.r === 'host')).length;
      if (others === 0) void channel.track({ r: 'host' });
      return others;
    },
    close() {
      void client!.removeChannel(channel);
    },
  };
}

function localTransport(room: string): Transport {
  const bc = new BroadcastChannel(channelName(room));
  const handlers: Handler[] = [];
  bc.onmessage = (e: MessageEvent<Wire>) => {
    if (e.data && typeof e.data === 'object') handlers.forEach((h) => h(e.data));
  };
  return {
    kind: 'local',
    ready: Promise.resolve(),
    send(msg) {
      bc.postMessage(msg);
    },
    on(cb) {
      handlers.push(cb);
    },
    async otherHosts() {
      return 0;
    },
    close() {
      bc.close();
    },
  };
}
