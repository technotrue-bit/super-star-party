import type { PartyMessage } from "./messages";
import { PARTY_ROOM_PATH, isPartyMessageType } from "./partyRoom";

/**
 * Friends-room transport.
 *
 * No `VITE_PARTY_URL`: two tabs on one origin share BroadcastChannel
 * `ssp-party-v1`. The sender does not hear its own post, so the host
 * applies a start locally and still broadcasts it.
 *
 * With `VITE_PARTY_URL`: a WebSocket to the PartyServer room. The worker
 * also withholds the sender's echo. See party/README.md. Do not deploy.
 */
const CHANNEL = "ssp-party-v1";

export interface PartyRelay {
  post(msg: PartyMessage): void;
  listen(fn: (msg: PartyMessage) => void): () => void;
  close(): void;
}

export type PartyRole = "host" | "guest";
export type PartyTransport = "tabs" | "server";

/** Worker origin from the Vite build, or null when the tab relay should be used. */
export function configuredPartyUrl(): string | null {
  const raw = import.meta.env.VITE_PARTY_URL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function partyTransport(): PartyTransport {
  return configuredPartyUrl() ? "server" : "tabs";
}

/**
 * WebSocket URL for one room.
 * `base` is the worker origin (`https://name.account.workers.dev`),
 * or that origin already ending in `/parties/ssp-room`.
 */
export function partySocketUrl(base: string, code: string, peerId: string, role: PartyRole): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed || !code || !peerId) return null;
  let origin = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(origin)) origin = `https://${origin}`;
  const wsBase = origin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  const prefix = /\/parties\//i.test(wsBase) ? wsBase : `${wsBase}/parties/${PARTY_ROOM_PATH}`;
  let url: URL;
  try {
    url = new URL(`${prefix}/${encodeURIComponent(code)}`);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  url.searchParams.set("_pk", peerId);
  url.searchParams.set("role", role);
  return url.toString();
}

export function openPartyRelay(opts: {
  code: string;
  peerId: string;
  role: PartyRole;
  onStatus?: (message: string) => void;
}): PartyRelay {
  const base = configuredPartyUrl();
  if (!base) return localTabRelay();
  const url = partySocketUrl(base, opts.code, opts.peerId, opts.role);
  if (!url) {
    opts.onStatus?.("Party server URL is not valid.");
    return silentRelay();
  }
  return cloudflareRelay(url, opts.onStatus);
}

export function localTabRelay(): PartyRelay {
  const channel = new BroadcastChannel(CHANNEL);
  return {
    post(msg) {
      channel.postMessage(msg);
    },
    listen(fn) {
      const onMessage = (ev: MessageEvent<PartyMessage>) => {
        fn(ev.data);
      };
      channel.addEventListener("message", onMessage);
      return () => channel.removeEventListener("message", onMessage);
    },
    close() {
      channel.close();
    },
  };
}

function silentRelay(): PartyRelay {
  return {
    post() {},
    listen() {
      return () => {};
    },
    close() {},
  };
}

function cloudflareRelay(url: string, onStatus?: (message: string) => void): PartyRelay {
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    onStatus?.("Could not reach the party server.");
    return silentRelay();
  }
  const queue: string[] = [];
  let opened = false;
  let closing = false;

  const flush = () => {
    if (socket.readyState !== WebSocket.OPEN) return;
    for (const data of queue) socket.send(data);
    queue.length = 0;
  };

  socket.addEventListener("open", () => {
    opened = true;
    flush();
    if (closing) socket.close();
  });
  socket.addEventListener("error", () => {
    if (!opened) onStatus?.("Could not reach the party server.");
  });

  return {
    post(msg) {
      const data = JSON.stringify(msg);
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
      else if (!closing && socket.readyState === WebSocket.CONNECTING && !queue.includes(data)) {
        queue.push(data);
      }
    },
    listen(fn) {
      const onMessage = (ev: MessageEvent) => {
        const parsed = parsePartyMessage(ev.data);
        if (parsed) fn(parsed);
      };
      socket.addEventListener("message", onMessage);
      return () => socket.removeEventListener("message", onMessage);
    },
    close() {
      closing = true;
      if (socket.readyState === WebSocket.OPEN) {
        flush();
        socket.close();
      }
    },
  };
}

function parsePartyMessage(data: unknown): PartyMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as { type?: unknown; code?: unknown };
  if (typeof rec.type !== "string" || typeof rec.code !== "string") return null;
  if (!isPartyMessageType(rec.type)) return null;
  return value as PartyMessage;
}
