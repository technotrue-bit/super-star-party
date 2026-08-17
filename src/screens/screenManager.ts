/**
 * SUPER STAR PARTY — screen state machine. Screens register here; the main
 * loop drives the active one. Wave agents add screens; never remove the
 * registry itself.
 */
import { bus } from "../core/events";

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

  register(screen: Screen): void {
    this.registry.set(screen.id, screen);
    if (!this._current && screen.id === "title") this._current = screen;
  }

  goto(id: string): void {
    const next = this.registry.get(id);
    if (!next) {
      console.warn(`[screens] unknown screen "${id}"`);
      return;
    }
    if (this._current === next && this._entered) return;
    if (this._current && this._entered) this._current.exit();
    this._current = next;
    next.enter();
    this._entered = true;
    bus.emit("screen:change", { from: this._current?.id ?? "none", to: id });
  }

  get current(): string {
    return this._current?.id ?? "none";
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
