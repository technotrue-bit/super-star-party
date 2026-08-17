/**
 * SUPER STAR PARTY — shared UI root element.
 * One fixed, pointer-events-none overlay hosts every kit component.
 */
import { injectStyles } from "./styles";

let uiRoot: HTMLDivElement | null = null;

/** Lazily create the shared fixed overlay (z-index 50). */
export function root(): HTMLDivElement {
  if (!uiRoot) {
    injectStyles();
    uiRoot = document.createElement("div");
    uiRoot.className = "ssp-ui";
    document.body.appendChild(uiRoot);
  }
  return uiRoot;
}

/** Remove all transient UI (used by ui.clearScreen). */
export function clearRoot(): void {
  if (uiRoot) uiRoot.innerHTML = "";
}
