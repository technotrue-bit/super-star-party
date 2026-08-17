/**
 * SUPER STAR PARTY — Gumball Shop popup.
 * Wave 2 (items + shop). Owned by the items builder.
 *
 * A gumball-machine themed popup: wallet header (avatar + live coin
 * counter), one cream card per item with a gold BUY button that disables
 * when the player can't afford it, and a CLOSE button. Buying goes through
 * buyItem (which spends coins via economy.addCoins and plays the shop
 * sting). The turn loop owns music — this screen only plays SFX.
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
.ssp-shop__card { display:flex; align-items:center; gap:12px; background:${palette.cream}; border:3px solid ${palette.ink}; border-radius:20px; padding:10px 12px; box-shadow:0 4px 0 ${palette.ink}; }
.ssp-shop__icon { font-size:34px; line-height:1; width:46px; text-align:center; flex:none; }
.ssp-shop__info { flex:1; min-width:0; }
.ssp-shop__name { font-size:17px; font-weight:700; color:${palette.ink}; }
.ssp-shop__desc { font-size:13px; color:${palette.inkSoft}; line-height:1.3; }
.ssp-shop__price { display:flex; align-items:center; gap:5px; margin-top:4px; font-size:16px; font-weight:700; color:${palette.ink}; }
`;
  document.head.appendChild(style);
}

/**
 * Open the Gumball Shop for `playerId`. Resolves with the item keys the
 * player bought when the popup closes (CLOSE button, Escape, or a screen
 * change). The shop never switches music tracks — SFX only.
 */
export function openShop(playerId: number): Promise<{ bought: string[] }> {
  const player = match.players[playerId];
  const bought: string[] = [];
  const coinsNow = (): number => match.players[playerId]?.coins ?? 0;

  return new Promise((resolve) => {
    injectShopStyles();
    audio.sfx.play("shop.buy"); // cheerful open sting

    const content = document.createElement("div");
    content.className = "ssp-shop";

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
    const counter = ui.coinCounter(counterEl, coinsNow());
    const walletCoin = document.createElement("span");
    walletCoin.className = "ssp-shop__wallet-coin";
    walletCoin.append(coin, counterEl);
    wallet.append(avatar, name, walletCoin);
    content.appendChild(wallet);

    // ---- item cards ----
    const grid = document.createElement("div");
    grid.className = "ssp-shop__grid";
    const buyButtons: Array<{ key: string; btn: ReturnType<typeof ui.button> }> = [];

    const refreshButtons = (): void => {
      const coins = coinsNow();
      for (const { key, btn } of buyButtons) {
        btn.setEnabled(coins >= (ITEM_DEFS[key]?.price ?? Infinity));
      }
    };

    for (const key of ITEM_ORDER) {
      const def = ITEM_DEFS[key];
      if (!def) continue;

      const card = document.createElement("div");
      card.className = "ssp-shop__card";

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
        disabled: coinsNow() < def.price,
      });
      btn.el.addEventListener("click", () => {
        if (buyItem(playerId, key)) {
          bought.push(key);
          counter.tweenTo(coinsNow());
          refreshButtons();
        }
      });

      card.append(icon, info, btn.el);
      grid.appendChild(card);
      buyButtons.push({ key, btn });
    }
    content.appendChild(grid);

    // ---- popup + close handling (CLOSE, Escape, screen change) ----
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
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
  });
}
