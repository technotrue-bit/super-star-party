/**
 * SUPER STAR PARTY — the rules, explained simply. ONE source for the How to
 * Play screen and the pause menu, so the two can never drift apart.
 *
 * Short sections, one idea per line, and the real space pictures (drawn from
 * the board's own disk art) next to what each space does. Numbers come from
 * settings, so a balance change updates the guide too.
 */
import { palette } from "../config/palette";
import { settings } from "../config/settings";
import { buildKit } from "../board/boardTextures";
import { activeBoard } from "../board/registry";
import { giverName, npcName, shopName } from "../board/boardText";
import { itemIcon, itemName } from "../game/items";
import type { SpaceType } from "../core/game";

const STYLE_ID = "ssp-guide-styles";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ssp-guide{display:flex;flex-direction:column;gap:12px;width:100%;font-family:Fredoka,sans-serif;color:${palette.ink};text-align:left}
    .ssp-guide__sec{background:${palette.cream};border:4px solid ${palette.ink};border-radius:18px;padding:12px 14px;box-shadow:0 4px 0 ${palette.ink}}
    .ssp-guide__head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
    .ssp-guide__icon{width:34px;height:34px;border-radius:50%;border:3px solid ${palette.ink};display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}
    .ssp-guide__ttl{font-size:18px;font-weight:700;letter-spacing:.5px}
    .ssp-guide__lead{font-size:16px;font-weight:600;line-height:1.35;margin:0 0 6px}
    .ssp-guide ol,.ssp-guide ul{margin:0;padding-left:22px;font-size:15px;line-height:1.45}
    .ssp-guide li{margin:2px 0}
    .ssp-guide b{color:${palette.inkSoft}}
    .ssp-guide__spaces{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
    .ssp-guide__space{display:flex;align-items:center;gap:8px;font-size:14px;line-height:1.25;font-weight:600}
    .ssp-guide__space img{width:40px;height:40px;flex:none;border-radius:50%;box-shadow:0 2px 0 ${palette.ink}}
    .ssp-guide__space span b{display:block;color:${palette.ink};font-size:14px}
    .ssp-guide__tip{margin-top:6px;font-size:13px;line-height:1.35;color:${palette.inkSoft}}
  `;
  document.head.appendChild(s);
}

let diskUrls: Partial<Record<SpaceType, string>> | null = null;

/** The board's real space pictures as small images (drawn once, then cached). */
function diskImages(): Partial<Record<SpaceType, string>> {
  if (diskUrls) return diskUrls;
  diskUrls = {};
  try {
    const kit = buildKit();
    for (const [type, tex] of Object.entries(kit.disks) as [SpaceType, { image: unknown }][]) {
      const img = tex.image as HTMLCanvasElement | undefined;
      if (img && typeof img.toDataURL === "function") diskUrls[type] = img.toDataURL();
    }
    kit.dispose();
  } catch {
    /* no canvas: the guide still reads fine without pictures */
  }
  return diskUrls;
}

function section(icon: string, color: string, title: string): { el: HTMLElement; body: HTMLElement } {
  const el = document.createElement("section");
  el.className = "ssp-guide__sec";
  const head = document.createElement("div");
  head.className = "ssp-guide__head";
  const ic = document.createElement("div");
  ic.className = "ssp-guide__icon";
  ic.style.background = color;
  ic.textContent = icon;
  const t = document.createElement("div");
  t.className = "ssp-guide__ttl";
  t.textContent = title;
  head.append(ic, t);
  const body = document.createElement("div");
  el.append(head, body);
  return { el, body };
}

function html(tag: string, inner: string, cls?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.innerHTML = inner;
  return el;
}

/** The whole guide, ready to drop into a page or a panel. */
export function buildRulesGuide(): HTMLElement {
  injectStyles();
  const S = settings;
  const root = document.createElement("div");
  root.className = "ssp-guide";
  root.dataset.sspGuide = "";

  // 1. The goal
  {
    const { el, body } = section("⭐", palette.sun, "THE GOAL");
    body.append(
      html("p", `Get the <b>most stars</b> by the end of the game. Tied on stars? <b>Most coins</b> wins.`, "ssp-guide__lead"),
      html("p", `Coins buy stars. Earn coins on the board and in minigames.`, "ssp-guide__tip"),
    );
    root.appendChild(el);
  }

  // 2. A turn
  {
    const { el, body } = section("🎲", palette.bubble, "YOUR TURN");
    body.append(
      html(
        "ol",
        `<li><b>Item?</b> Want to use an item? Tap it first (one per turn).</li>
         <li><b>Roll!</b> Tap <b>ROLL</b> to hit the dice block.</li>
         <li><b>Move.</b> Your character walks that many spaces. At a fork, pick a path.</li>
         <li><b>Space!</b> Wherever you stop, that space does its thing.</li>`,
      ),
      html("p", `Everyone takes a turn, then a new round starts. The game lasts ${S.totalTurns} rounds.`, "ssp-guide__tip"),
    );
    root.appendChild(el);
  }

  // 3. The spaces, with the real pictures
  {
    const { el, body } = section("🟦", palette.mint, "THE SPACES");
    body.appendChild(html("p", "Most spaces work when you <b>stop</b> on them.", "ssp-guide__lead"));
    const grid = document.createElement("div");
    grid.className = "ssp-guide__spaces";
    const pics = diskImages();
    const rows: [SpaceType, string, string][] = [
      ["blue", "Blue", `+${S.blueCoin} coins. Sometimes a Hidden Block pops out!`],
      ["red", "Red", `−${S.redCoin} coins.`],
      ["green", "? Space", "A surprise event. Could be good, could be silly!"],
      ["grumpus", npcName(), `Uh-oh. ${npcName()} causes trouble.`],
      ["shop", shopName(), "Buy items. Works when you pass it, too."],
      ["stamp", "Stamp", `Collect all 3 stamps for ${S.stampJackpot} coins. Passing counts.`],
      ["minigame_balloon", "Minigame Balloon", "Pay 5 or 10 coins (passing counts). Everyone plays a minigame after the round."],
    ];
    for (const [type, name, what] of rows) {
      const row = document.createElement("div");
      row.className = "ssp-guide__space";
      const src = pics[type];
      if (src) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = src;
        row.appendChild(img);
      }
      row.appendChild(html("span", `<b>${name}</b>${what}`));
      grid.appendChild(row);
    }
    body.appendChild(grid);
    root.appendChild(el);
  }

  // 4. Stars
  {
    const { el, body } = section("🎈", palette.candy, "GETTING STARS");
    body.append(
      html("p", `Find the <b>Grand Prize Balloon</b> (the big gold balloon). Walk past it or stop on it to buy stars: <b>${S.starCost} coins each</b>, up to ${S.starBundleMax} at once.`, "ssp-guide__lead"),
      html("p", `After someone buys, the balloon flies to a new spot. The top of the screen shows how many spaces away it is.`, "ssp-guide__tip"),
    );
    root.appendChild(el);
  }

  // 5. Minigames
  {
    const [c1, c2, c3] = S.minigamePlaceCoins;
    const { el, body } = section("🎮", palette.berry, "MINIGAMES");
    body.append(
      html("p", `When a Minigame Balloon gets popped, everyone plays a minigame at the end of the round.`, "ssp-guide__lead"),
      html("ul", `<li>Each minigame shows how to play and lets you <b>practice</b> before GO.</li><li>Some games use a new control: <b>HOLD</b> a button to charge and let go to throw, <b>SWIPE</b> to flick, tap <b>two buttons</b>, spin a <b>wheel</b>, or <b>draw</b> a path. On a keyboard: Space, arrows, Z and X, Q and E, or the mouse.</li><li>Prizes: <b>1st ${c1}</b>, <b>2nd ${c2}</b>, <b>3rd ${c3}</b> coins (team games: ${c1} each for the winners).</li>`),
      html("p", `Just want to play minigames? Pick <b>MINIGAMES</b> on the title screen.`, "ssp-guide__tip"),
    );
    root.appendChild(el);
  }

  // 6. Items
  {
    // A board skin (Downtown) renames the items, the shop and the giver; the
    // carnival keeps its original lines.
    const shop = shopName();
    const giver = giverName();
    const skinned = !!activeBoard().skin?.items;
    const zips = skinned ? `<b>${itemName("dash_mushroom")}</b> and <b>${itemName("golden_dash")}</b>` : "<b>Zip Mushrooms</b>";
    const freebie = giver ? `a free item from <b>${giver}</b>` : "a free item";
    const { el, body } = section(skinned ? itemIcon("dash_mushroom") : "🍄", palette.mint, "ITEMS");
    body.append(
      html("p", `Buy items at the <b>${shop}</b>. Use <b>one item per turn</b>, before you roll.`, "ssp-guide__lead"),
      html(
        "ul",
        `<li>${zips} add spaces to your roll. A <b>${itemName("poison_mushroom")}</b> takes 2 off a rival's roll.</li>
         <li><b>${itemName("double_dice")}</b> rolls two dice.</li>
         <li><b>Orbs</b> are traps: throw one onto a space up to ${S.orbThrowRange} steps away. It hits whoever stops there.</li>`,
      ),
      html("p", `The ${shop} says what every item does. Last place gets ${freebie} in the last 5 rounds.`, "ssp-guide__tip"),
    );
    root.appendChild(el);
  }

  // 7. Bonus stars + little extras
  {
    const { el, body } = section("🏆", palette.sun, "BONUS STARS & EXTRAS");
    body.append(
      html(
        "ul",
        `<li>At the end, bonus stars go to the most <b>minigame wins</b>, the most <b>coins</b>, and the most <b>stamps</b>.</li>
         <li>Stop on a space someone is already on? <b>Group hug:</b> +${S.squeezeCoins} coins each.</li>
         <li>Tap 🔍 any time to look around the whole board.</li>`,
      ),
    );
    root.appendChild(el);
  }
  return root;
}
