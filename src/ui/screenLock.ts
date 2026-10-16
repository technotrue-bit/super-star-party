/**
 * Page screen lock. Taps, stick drags, swipes and drawing during play must
 * never scroll, zoom or select the page. index.html pins the body with CSS
 * (touch-action: none, fixed, overflow hidden); this enforces the rest from
 * script for the browsers that ignore it (iOS Safari pinch and double-tap).
 */

let installed = false;

export function screenLockInstalled(): boolean {
  return installed;
}

/** Install the page-wide gesture blockers. Safe to call more than once. */
export function installScreenLock(): void {
  if (installed) return;
  installed = true;

  const block = (e: Event): void => {
    e.preventDefault();
  };
  // Safari pinch gestures and double-click zoom.
  document.addEventListener("gesturestart", block, { passive: false });
  document.addEventListener("gesturechange", block, { passive: false });
  document.addEventListener("dblclick", block, { passive: false });
  // Long-press menus on touch and right-click on desktop.
  document.addEventListener("contextmenu", block, { passive: false });
  // Two or more fingers moving is a pinch; one finger stays free for the game.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );

  // If the visual viewport is ever panned off the origin, snap it back.
  const snapBack = (): void => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  };
  window.visualViewport?.addEventListener("scroll", snapBack);
  window.visualViewport?.addEventListener("resize", snapBack);
}
