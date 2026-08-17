/**
 * SUPER STAR PARTY — cleanup registry.
 * Transient UI (popups, dialogs) registers cleanup handlers here so
 * ui.clearScreen() can tear them down properly (e.g. remove key listeners).
 */

const cleanups = new Set<() => void>();

/** Register a cleanup function that clearScreen() will invoke. */
export function onCleanup(fn: () => void): void {
  cleanups.add(fn);
}

/** Run and clear all registered cleanups. */
export function runCleanups(): void {
  for (const fn of Array.from(cleanups)) {
    try {
      fn();
    } catch {
      /* never let a cleanup break clearScreen */
    }
  }
  cleanups.clear();
}
