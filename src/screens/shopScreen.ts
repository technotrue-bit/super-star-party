/**
 * SUPER STAR PARTY — Gumball Shop popup.
 * Wave 2 (items + shop). Owned by the items builder.
 *
 * A gumball-machine themed popup: wallet header (avatar + live coin
 * counter), one cream card per item with a gold BUY button that disables
 * when the player can't afford it, and a CLOSE button. Buying goes through
 * buyItem (which spends coins via economy.addCoins and plays the shop
 * sting). The turn loop owns music — this screen only plays SFX.
 *
 * ## Verifiability
 * The shop can be opened on demand for inspection — it does NOT auto-resolve
 * for the human (it waits indefinitely for a real decision). Two entry points:
 *   - window.__SSP__.openShop(playerId?) — debug API hook
 *   - ?shop=1 URL param on the board screen
 * Under autoplay the turn loop opens it too but auto-closes after >=1.2s.
 */
import { match } from "../core/game";
import { bus } from "../core/events";
import { palette } from "../config/palette";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { ITEM_DEFS, ITEM_ORDER, buyItem } from "../game/items";

let stylesInjected = false;

/** Scoped shop styles (injected once; every color from the palette). */
function injectShopStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById("ssp-shop-styles")) return;
  const style = document.createElement("style");
  style.id = "ssp-shop-styles";
  style.textContent = `
.ssp-shop { display:flex; flex-direction:column; gap:14px; width:min(74vw, 380px); text-align:left; }
.ssp-shop__wallet { display:flex; align-items:center; gap:10px; background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:999px; padding:5px 16px 5px 5px; box-shadow:0 4px 0 ${palette.ink}; }
.ssp-shop__wallet-name { font-size:15px; font-weight:700; color:${palette.ink}; }
.ssp-shop__wallet-coin { margin-left:auto; display:flex; align-items:center; gap:6px; }
.ssp-shop__coin { width:22px; height:22px; border-radius:50%; flex:none;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.85) 0%, rgba(255,255,255,0) 42%),
              linear-gradient(180deg, ${palette.sun} 0%, ${palette.sunDeep} 100%);
  border:2px solid ${palette.ink}; box-shadow: inset 0 -3px 0 rgba(43,29,78,.25); }
.ssp-shop__counter { min-width:30px; text-align:center; font-size:20px; font-weight:700; color:${palette.ink}; }
.ssp-shop__grid { display:flex; flex-direction:column; gap:12px; max-height:44vh; overflow-y:auto; padding:3px 2px; }
.ssp-shop__card { display:flex; align-items:center; gap:12px; background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:20px; padding:10px 12px; box-shadow:0 4px 0 ${palette.ink}; transition: opacity .25s ease-out, filter .25s ease-out; }
.ssp-shop__card--poor { opacity:.62; filter: grayscale(.55) brightness(.92); }
.ssp-shop__icon { font-size:34px; line-height:1; width:46px; text-align:center; flex:none; }
.ssp-shop__info { flex:1; min-width:0; }
.ssp-shop__name { font-size:17px; font-weight:700; color:${palette.ink}; }
.ssp-shop__desc { font-size:13px; color:${palette.inkSoft}; line-height:1.3; }
.ssp-shop__price { display:flex; align-items:center; gap:5px; margin-top:4px; font-size:16px; font-weight:700; color:${palette.ink}; }
.ssp-shop__unaffordable { margin-top:6px; font-size:12px; font-weight:700; color:${palette.lava}; }
/* --- Fizzy Fairgrounds carnival awning (the stall front) --- */
.ssp-shop__awning { display:flex; align-items:center; gap:10px; background:repeating-linear-gradient(45deg, ${palette.tentRed} 0%, ${palette.tentRed} 10px, ${palette.cream} 10px, ${palette.cream} 20px); border:3px solid ${palette.ink}; border-bottom-width:5px; border-radius:16px; padding:8px 14px; margin:0 0 12px; box-shadow:0 4px 0 ${palette.ink}; }
.ssp-shop__shopkeeper { font-size:28px; line-height:1; flex:none; filter:drop-shadow(0 2px 0 rgba(43,29,78,.5)); }
.ssp-shop__stall-title { font-size:15px; font-weight:700; color:${palette.ink}; flex:1; }
.ssp-shop__stall-sub { font-size:11px; color:${palette.inkSoft}; }
/* --- owned item card (player holds this gumball) --- */
.ssp-shop__card--owned { position:relative; border-color:${palette.mint}; box-shadow:0 0 0 4px ${palette.mint}, 0 4px 0 ${palette.ink}; }
.ssp-shop__owned-badge { position:absolute; top:-10px; right:-10px; background:${palette.mint}; color:${palette.ink}; border:2px solid ${palette.ink}; border-radius:999px; font-size:11px; font-weight:700; padding:3px 10px; line-height:1; box-shadow:0 2px 0 ${palette.ink}; text-shadow:0 1px 0 rgba(255,255,255,.5); }
.ssp-btn.ssp-shop__buy--owned { background:linear-gradient(180deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 42%), linear-gradient(180deg, ${palette.mint} 0%, ${palette.mintDeep} 100%); color:${palette.ink}; }

/* --- while the stall is open, the board chrome is NOT interactive ---
   The shop is a modal: leaving ROLL!, the pause FAB and the player chips live
   underneath let a player roll dice or open menus through the stall. Keyed off
   the shop's own presence so nothing has to remember to toggle a class. */
body:has(.ssp-shop) .ssp-roll-wrap,
body:has(.ssp-shop) .ssp-pause-fab,
body:has(.ssp-shop) .ssp-hud,
body:has(.ssp-shop) .ssp-item-bar {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;
  document.head.appendChild(style);
}

export interface OpenShopOpts {
  /** Auto-close after this many ms (used by autoplay to keep flow moving). */
  autoCloseMs?: number;
}

/**
 * Open the Gumball Shop for `playerId`. Resolves with the item keys the
 * player bought when the popup closes (CLOSE button, Escape, or a screen
 * change). The shop never switches music tracks — SFX only.
 *
 * For the HUMAN player there is NO timeout — the shop waits indefinitely
 * for a real decision (buy or explicitly leave). Only autoplay passes
 * `autoCloseMs` so it resolves after a real beat (>=1.2s), and only after
 * the UI has been built and shown.
 */
export function openShop(playerId: number, opts?: OpenShopOpts): Promise<{ bought: string[] }> {
  const player = match.players[playerId];
  const bought: string[] = [];
  const coinsNow = (): number => match.players[playerId]?.coins ?? 0;

  return new Promise((resolve) => {
    injectShopStyles();
    audio.sfx.play("shop.buy");

    const content = document.createElement("div");
    content.className = "ssp-shop";

    // ---- Fizzy Fairgrounds carnival awning: the stall front ----
    const awning = document.createElement("div");
    awning.className = "ssp-shop__awning";
    const shopkeeper = document.createElement("span");
    shopkeeper.className = "ssp-shop__shopkeeper";
    shopkeeper.textContent = "👹";
    shopkeeper.setAttribute("aria-hidden", "true");
    const awningText = document.createElement("div");
    awningText.style.flex = "1";
    const awningTitle = document.createElement("div");
    awningTitle.className = "ssp-shop__stall-title";
    awningTitle.textContent = "GRUMPUS'S GUMBOOTH";
    const awningSub = document.createElement("div");
    awningSub.className = "ssp-shop__stall-sub";
    awningSub.textContent = "Gumball Emporium · Fizzy Fairgrounds";
    awningText.append(awningTitle, awningSub);
    awning.append(shopkeeper, awningText);
    content.appendChild(awning);

    // ---- wallet header: avatar + name + live coin counter ----
    const wallet = document.createElement("div");
    wallet.className = "ssp-shop__wallet";
    const avatar = ui.playerAvatar(player?.kind ?? "?");
    avatar.style.width = "34px";
    avatar.style.height = "34px";
    avatar.style.fontSize = "15px";
    const name = document.createElement("span");
    name.className = "ssp-shop__wallet-name";
    name.textContent = player?.name ?? `P${playerId + 1}`;
    const coin = document.createElement("span");
    coin.className = "ssp-shop__coin";
    coin.setAttribute("aria-hidden", "true");
    const counterEl = document.createElement("span");
    counterEl.className = "ssp-shop__counter";
    counterEl.setAttribute("data-wallet", "true");
    const counter = ui.coinCounter(counterEl, coinsNow());
    const walletCoin = document.createElement("span");
    walletCoin.className = "ssp-shop__wallet-coin";
    walletCoin.append(coin, counterEl);
    wallet.append(avatar, name, walletCoin);
    content.appendChild(wallet);

    // ---- item cards ----
    const grid = document.createElement("div");
    grid.className = "ssp-shop__grid";
    const buyButtons: Array<{ key: string; btn: ReturnType<typeof ui.button>; card: HTMLDivElement; price: number }> = [];

    /** Flip a card's BUY button into the OWNED state (or back out of it). */
    const applyOwnedState = (card: HTMLDivElement, btn: ReturnType<typeof ui.button>, owned: boolean): void => {
      if (owned) {
        card.classList.add("ssp-shop__card--owned");
        btn.setLabel("OWNED");
        btn.setEnabled(false);
        btn.el.classList.add("ssp-shop__buy--owned");
        if (!card.querySelector(".ssp-shop__owned-badge")) {
          const badge = document.createElement("div");
          badge.className = "ssp-shop__owned-badge";
          badge.textContent = "OWNED";
          card.appendChild(badge);
        }
        card.querySelector(".ssp-shop__unaffordable")?.remove();
      } else {
        card.classList.remove("ssp-shop__card--owned");
        btn.setLabel("BUY");
        btn.el.classList.remove("ssp-shop__buy--owned");
        card.querySelector(".ssp-shop__owned-badge")?.remove();
      }
    };

    const refreshAffordability = (): void => {
      const coins = coinsNow();
      for (const { key, btn, card, price } of buyButtons) {
        // Owned takes precedence: a held gumball can't be bought again.
        if ((player?.items ?? []).includes(key)) {
          applyOwnedState(card, btn, true);
          continue;
        }
        applyOwnedState(card, btn, false);
        const canAfford = coins >= price;
        btn.setEnabled(canAfford);
        if (canAfford) {
          card.classList.remove("ssp-shop__card--poor");
          card.querySelector(".ssp-shop__unaffordable")?.remove();
        } else {
          card.classList.add("ssp-shop__card--poor");
          if (!card.querySelector(".ssp-shop__unaffordable")) {
            const ua = document.createElement("div");
            ua.className = "ssp-shop__unaffordable";
            ua.textContent = "CAN'T AFFORD";
            card.querySelector(".ssp-shop__info")!.appendChild(ua);
          }
        }
      }
    };

    for (const key of ITEM_ORDER) {
      const def = ITEM_DEFS[key];
      if (!def) continue;

      const card = document.createElement("div");
      card.className = "ssp-shop__card";
      card.setAttribute("data-item", key);
      card.setAttribute("data-price", String(def.price));

      const icon = document.createElement("div");
      icon.className = "ssp-shop__icon";
      icon.textContent = def.icon;
      icon.setAttribute("aria-hidden", "true");

      const info = document.createElement("div");
      info.className = "ssp-shop__info";
      const nm = document.createElement("div");
      nm.className = "ssp-shop__name";
      nm.textContent = def.name;
      const desc = document.createElement("div");
      desc.className = "ssp-shop__desc";
      desc.textContent = def.desc;
      const price = document.createElement("div");
      price.className = "ssp-shop__price";
      const pc = document.createElement("span");
      pc.className = "ssp-shop__coin";
      pc.style.width = "16px";
      pc.style.height = "16px";
      pc.style.borderWidth = "1.5px";
      const pv = document.createElement("span");
      pv.textContent = String(def.price);
      price.append(pc, pv);
      info.append(nm, desc, price);

      const btn = ui.button({
        label: "BUY",
        kind: "gold",
        size: "sm",
        disabled: (player?.items ?? []).includes(key) || coinsNow() < def.price,
      });
      btn.el.setAttribute("data-buy", key);
      btn.el.addEventListener("click", () => {
        // Already holding this gumball — not purchasable again until used.
        if ((player?.items ?? []).includes(key)) return;
        if (coinsNow() < def.price) {
          // Can't afford — shake the card for feedback.
          try {
            card.animate(
              [
                { transform: "translateX(0)" },
                { transform: "translateX(-4px)", offset: 0.2 },
                { transform: "translateX(4px)", offset: 0.4 },
                { transform: "translateX(-3px)", offset: 0.6 },
                { transform: "translateX(0)" },
              ],
              { duration: 260, easing: "ease-out" }
            );
          } catch {
            /* animation unavailable — card still visible */
          }
          return;
        }
        if (buyItem(playerId, key)) {
          bought.push(key);
          const newCoins = coinsNow();
          counter.tweenTo(newCoins);
          refreshAffordability();
          // Buy feedback: floating number rises from the button + a toast.
          const rect = btn.el.getBoundingClientRect();
          ui.showFloatingNumber(rect.left + rect.width / 2, rect.top - 8, -def.price, { durationMs: 700 });
          ui.toast(`Got the ${def.name}!`, { durationMs: 1500, priority: "high" });
        }
      });

      card.append(icon, info, btn.el);
      grid.appendChild(card);
      buyButtons.push({ key, btn, card, price: def.price });
    }
    content.appendChild(grid);
    refreshAffordability();

    // ---- popup + close handling (CLOSE, Escape, screen change) ----
    let closed = false;
    let autoCloseTimer: number | null = null;
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (autoCloseTimer !== null) {
        window.clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
      }
      window.removeEventListener("keydown", onKey);
      offScreen();
      pop.destroy();
      resolve({ bought });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // A screen change mid-shopping must still resolve the caller.
    const offScreen = bus.on("screen:change", close);

    const pop = ui.popup({
      title: "GUMBALL SHOP",
      body: "Grab a gumball for your bag!",
      content,
      closeOnEsc: false, // Esc handled here so the promise always resolves
      sound: null, // open sting played explicitly above
      buttons: [{ label: "CLOSE", kind: "ghost", onClick: close }],
    });

    // Tag the shop + close button for testability.
    pop.el.setAttribute("data-shop", "true");
    const closeBtn = pop.el.querySelector<HTMLElement>(".ssp-popup__buttons button:last-child");
    if (closeBtn) closeBtn.setAttribute("data-shop-close", "true");

    // Auto-close for autoplay: show for a real beat (>=1.2s), then resolve.
    // For the human, NO timer — the shop waits indefinitely for a decision.
    if (opts?.autoCloseMs && opts.autoCloseMs > 0) {
      autoCloseTimer = window.setTimeout(() => {
        autoCloseTimer = null;
        close();
      }, opts.autoCloseMs);
    }
  });
}
