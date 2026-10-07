/**
 * Phone-visible viewport. iOS Safari's window.innerHeight includes the area
 * behind the toolbar; visualViewport is the rectangle the player can see.
 * Desktop (no visualViewport) falls back to the window size, so this is a no-op.
 */

export function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Subscribe to window + visualViewport changes. Returns an unsubscribe. */
export function onViewportChange(fn: () => void): () => void {
  window.addEventListener("resize", fn);
  window.visualViewport?.addEventListener("resize", fn);
  window.visualViewport?.addEventListener("scroll", fn);
  return () => {
    window.removeEventListener("resize", fn);
    window.visualViewport?.removeEventListener("resize", fn);
    window.visualViewport?.removeEventListener("scroll", fn);
  };
}

/** Pin #app to the visible viewport so the canvas is not hidden under Safari chrome. */
export function fitAppToViewport(): void {
  const app = document.getElementById("app");
  if (!app) return;
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  app.style.position = "fixed";
  app.style.left = `${vv?.offsetLeft ?? 0}px`;
  app.style.top = `${vv?.offsetTop ?? 0}px`;
  app.style.width = `${w}px`;
  app.style.height = `${h}px`;
}
