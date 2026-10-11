/**
 * SUPER STAR PARTY — typed event bus. Screens/gameplay/audio communicate by
 * events; nothing reaches into another system's internals.
 * Wave agents may ADD event names; never rename/remove existing ones.
 */
export interface SSPEventMap {
  "screen:change": { from: string; to: string };
  "match:start": { seed: number; players: number[] };
  "match:end": { ranking: number[] };
  "turn:start": { turn: number; player: number };
  "dice:roll": { player: number; face: number };
  "dice:land": { player: number; face: number };
  "player:move": { player: number; from: number; to: number };
  "player:land": { player: number; space: number; type: string };
  "coins:change": { player: number; delta: number; total: number };
  "star:buy": { player: number; star: number; total: number; bought: number; spent: number };
  "star:balloon_moved": { from: number; to: number; by: number; cause?: "buy" | "breeze" | "trap" };
  /** Presentation only: the post-ceremony reveal of a bought balloon's new spot. */
  "star:reveal": { from: number; to: number };
  "happening:event": { player: number; eventId: string; label: string };
  "stamp:collected": { player: number; kind: string; total: number };
  "stamp:jackpot": { player: number; amount: number };
  "balloon:popped": { player: number; coins: number; listed: number };
  /** Everyone standing on the space, including the player who just ended there. */
  "squeeze:hug": { space: number; players: number[]; coins: number };
  "pity:gift": { player: number; item: string };
  "minigame:start": { id: string; name: string };
  "minigame:end": { id: string; winner: number; coins: number };
  "results:show": { ranking: number[] };
  "audio:track": { track: string; playing: boolean };
  "audio:sfx": { name: string };
  "ui:toast": { text: string };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof SSPEventMap>(event: K, fn: Handler<SSPEventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<unknown>);
    return () => this.off(event, fn as Handler<unknown>);
  }

  off<K extends keyof SSPEventMap>(event: K, fn: Handler<SSPEventMap[K]>): void {
    this.handlers.get(event)?.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof SSPEventMap>(event: K, payload: SSPEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<SSPEventMap[K]>)(payload);
      } catch (err) {
        // One broken listener must never kill the game loop.
        console.error(`[bus] handler error for ${String(event)}`, err);
      }
    }
  }

  /** Count listeners (debug/QA aid). */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

export const bus = new EventBus();
