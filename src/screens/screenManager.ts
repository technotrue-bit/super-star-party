/**
 * SUPER STAR PARTY — screen state machine. Screens register here; the main
 * loop drives the active one. Wave agents add screens; never remove the
 * registry itself.
 */
import { bus } from "../core/events";
import { playWipe, peekWipeKind, type WipeKind } from "../ui/transitions";

export interface Screen {
  id: string;
  enter(): void;
  exit(): void;
  update(dt: number): void;
  render(): void;
}

class ScreenManager {
  private registry = new Map<string, Screen>();
  private _current: Screen | null = null;
  private _entered = false;

  /** True while a wipe is in progress (covering/uncovering). */
  private _wiping = false;

  /** Deferred goto target — set if goto() is called mid-wipe (last wins). */
  private _pendingGoto: string | null = null;

  /** True only for the very first goto() — the boot render skips the wipe. */
  private _bootDone = false;

  register(screen: Screen): void {
    this.registry.set(screen.id, screen);
    if (!this._current && screen.id === "title") this._current = screen;
  }

  /**
   * Transition to another screen with an MP7-style full-screen wipe.
   *
   * On the FIRST call (boot render from main.ts) the wipe is skipped so the
   * player never stares at a candy curtain before the title even paints.
   * Subsequent calls play a wipe: the old screen is covered, the swap happens
   * at full cover, then the wipe uncovers.
   *
   * Re-entrancy: if goto() is called while a wipe is in flight, the new target
   * is stored and replayed once the current wipe finishes. Last-wins.
   */
  goto(id: string): void {
    const next = this.registry.get(id);
    if (!next) {
      console.warn(`[screens] unknown screen "${id}"`);
      return;
    }
    if (this._current === next && this._entered) return;

    // Boot render: skip the wipe, just enter immediately.
    if (!this._bootDone) {
      this._bootDone = true;
      if (this._current && this._entered) this._current.exit();
      this._current = next;
      next.enter();
      this._entered = true;
      bus.emit("screen:change", { from: this._current?.id ?? "none", to: id });
      return;
    }

    // Re-entrancy guard: a goto during a wipe supersedes any earlier pending
    // target but lets the in-flight wipe finish first.
    if (this._wiping) {
      this._pendingGoto = id;
      return;
    }

    this._wiping = true;
    const self = this;
    const fromId = this._current?.id ?? "none";

    // Capture the outgoing + incoming screens so the wipe closure doesn't
    // race with any later synchronous state change.
    const outgoing = this._current;
    const incoming = next;

    playWipe({
      onCover() {
        if (outgoing && self._entered) outgoing.exit();
        self._current = incoming;
        incoming.enter();
        self._entered = true;
        bus.emit("screen:change", { from: fromId, to: id });
      },
      onDone() {
        self._wiping = false;
        if (self._pendingGoto) {
          const deferred = self._pendingGoto;
          self._pendingGoto = null;
          self.goto(deferred);
        }
      },
    });
  }

  get current(): string {
    return this._current?.id ?? "none";
  }

  /** The wipe kind that the next goto will use (QA/preview aid). */
  get nextWipe(): WipeKind {
    return peekWipeKind();
  }

  /** True while a wipe is actively covering/uncovering. */
  get isWiping(): boolean {
    return this._wiping;
  }

  update(dt: number): void {
    this._current?.update(dt);
  }

  render(): void {
    this._current?.render();
  }

  /** Screens that exist (debug/QA aid). */
  available(): string[] {
    return [...this.registry.keys()];
  }
}

export const screens = new ScreenManager();
