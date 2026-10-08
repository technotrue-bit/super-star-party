import type { PartyMessage } from "./messages";

/**
 * Two localhost tabs share this channel. The sender does not hear its
 * own post, so the host applies a start locally and still broadcasts it.
 * No server and no Cloudflare account.
 */
const CHANNEL = "ssp-party-v1";

export interface PartyRelay {
  post(msg: PartyMessage): void;
  listen(fn: (msg: PartyMessage) => void): () => void;
  close(): void;
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
