/**
 * SUPER STAR PARTY — party HUD.
 * Top row of player chips (avatar dot, name, coins, stars, minigame wins),
 * active player glows gold + bounces, plus a center-top banner slot for
 * announcements. Defensive update(): missing fields degrade gracefully.
 * Container is pointer-events none; chips are interactive.
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { playerAvatar } from "./avatar";
import { STAMP_KINDS, STAMP_LABEL, type StampKind } from "../core/game";

/**
 * Single-banner-channel hook. When kit.ts wires this, every HUD banner is routed
 * through the shared feedback queue so the board cannot show two banners at once
 * (the turn banner and a space-event banner used to stack on top of each other).
 */
type BannerSink = (text: string, opts?: { durationMs?: number }) => { el: HTMLElement; destroy(): void };
let bannerSink: BannerSink | null = null;

/** Installed by kit.ts — routes showBanner() through the serialized queue. */
export function setHudBannerSink(fn: BannerSink | null): void {
  bannerSink = fn;
}

export interface HudPlayerState {
  id?: string | number;
  kind?: string;
  name?: string;
  coins?: number;
  stars?: number;
  minigameWins?: number;
  /** Stamp kinds currently held (Fizz / Crumb / Taffy). */
  stamps?: string[];
  active?: boolean;
  color?: string;
}

export interface HudHandle {
  el: HTMLDivElement;
  update(players: HudPlayerState[]): void;
  /** Center-top announcement in the HUD banner slot. */
  showBanner(text: string, opts?: { durationMs?: number }): { el: HTMLElement; destroy(): void };
  destroy(): void;
}

interface ChipRec {
  chip: HTMLElement;
  avatar: HTMLElement;
  avKey: string;
  nameEl: HTMLElement;
  coinsEl: HTMLElement;
  starsEl: HTMLElement;
  winsEl: HTMLElement;
  stampPips: HTMLElement[];
  lastCoins: number;
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function makeChip(p: HudPlayerState, idx: number): ChipRec {
  const kind = p.kind ?? "";
  const chip = document.createElement("div");
  chip.className = "ssp-hud-chip";

  const avatar = playerAvatar(kind || `player ${idx + 1}`, p.color);
  avatar.classList.add("ssp-hud-chip__avatar");

  const info = document.createElement("div");
  info.className = "ssp-hud-chip__info";

  const nameEl = document.createElement("div");
  nameEl.className = "ssp-hud-chip__name";

  const stats = document.createElement("div");
  stats.className = "ssp-hud-chip__stats";

  const coinIcon = document.createElement("span");
  coinIcon.className = "ssp-hud-coin";
  coinIcon.setAttribute("aria-hidden", "true");

  const coinsEl = document.createElement("span");
  coinsEl.setAttribute("aria-label", "coins");

  const starIcon = document.createElement("span");
  starIcon.className = "ssp-hud-star";
  starIcon.textContent = "\u2605";
  starIcon.setAttribute("aria-hidden", "true");

  const starsEl = document.createElement("span");
  starsEl.setAttribute("aria-label", "stars");

  const miniIcon = document.createElement("span");
  miniIcon.className = "ssp-hud-mini";
  miniIcon.textContent = "\u2605";
  miniIcon.setAttribute("aria-hidden", "true");

  const winsEl = document.createElement("span");
  winsEl.setAttribute("aria-label", "minigame wins");

  const stamps = document.createElement("span");
  stamps.className = "ssp-hud-stamps";
  stamps.setAttribute("aria-label", "stamps");
  const stampPips = STAMP_KINDS.map((kind) => {
    const pip = document.createElement("span");
    pip.className = `ssp-hud-stamp ssp-hud-stamp--${kind}`;
    pip.title = `${STAMP_LABEL[kind]} stamp`;
    stamps.appendChild(pip);
    return pip;
  });

  stats.append(coinIcon, coinsEl, starIcon, starsEl, miniIcon, winsEl, stamps);
  info.append(nameEl, stats);
  chip.append(avatar, info);

  return {
    chip,
    avatar,
    avKey: `${kind}|${p.color ?? ""}`,
    nameEl,
    coinsEl,
    starsEl,
    winsEl,
    stampPips,
    lastCoins: -1,
  };
}

export function hud(): HudHandle {
  injectStyles();
  const el = document.createElement("div");
  el.className = "ssp-hud";
  el.setAttribute("aria-label", "Party HUD");
  root().appendChild(el);

  const chips = new Map<string, ChipRec>();

  function update(players: HudPlayerState[]): void {
    const seen = new Set<string>();
    players.forEach((p, idx) => {
      const id = String(p.id ?? `p${idx}`);
      seen.add(id);

      let rec = chips.get(id);
      if (!rec) {
        rec = makeChip(p, idx);
        chips.set(id, rec);
        el.appendChild(rec.chip);
      }

      // Avatar: rebuild only when kind/color actually changed.
      const kind = p.kind ?? "";
      const avKey = `${kind}|${p.color ?? ""}`;
      if (avKey !== rec.avKey) {
        const fresh = playerAvatar(kind || `player ${idx + 1}`, p.color);
        fresh.classList.add("ssp-hud-chip__avatar");
        rec.chip.replaceChild(fresh, rec.avatar);
        rec.avatar = fresh;
        rec.avKey = avKey;
      }

      const name = p.name ?? (kind ? cap(kind) : `Player ${idx + 1}`);
      rec.nameEl.textContent = name;
      rec.chip.title = name;

      rec.coinsEl.textContent = String(Math.max(0, Math.round(p.coins ?? 0)));
      rec.starsEl.textContent = String(Math.max(0, Math.round(p.stars ?? 0)));
      rec.winsEl.textContent = String(Math.max(0, Math.round(p.minigameWins ?? 0)));

      const held = new Set(p.stamps ?? []);
      rec.stampPips.forEach((pip, i) => {
        const kind: StampKind = STAMP_KINDS[i];
        pip.classList.toggle("ssp-hud-stamp--on", held.has(kind));
      });

      rec.chip.classList.toggle("ssp-hud-chip--active", p.active === true);

      const cv = Math.max(0, Math.round(p.coins ?? 0));
      if (rec.lastCoins >= 0 && cv !== rec.lastCoins) {
        try {
          rec.coinsEl.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(1.4)", offset: 0.4 },
              { transform: "scale(1)" },
            ],
            { duration: 240, easing: "cubic-bezier(.34,1.56,.64,1)" }
          );
        } catch {
          /* noop */
        }
      }
      rec.lastCoins = cv;
    });

    for (const [id, rec] of Array.from(chips)) {
      if (!seen.has(id)) {
        rec.chip.remove();
        chips.delete(id);
      }
    }
  }

  function showBanner(text: string, opts?: { durationMs?: number }) {
    if (bannerSink) return bannerSink(text, opts);
    const b = document.createElement("div");
    b.className = "ssp-hud-banner";
    b.setAttribute("role", "status");
    b.textContent = text;
    el.appendChild(b);

    void b.offsetHeight;
    requestAnimationFrame(() => b.classList.add("ssp-hud-banner--show"));

    const dur = opts?.durationMs ?? 1400;
    const timer =
      dur > 0
        ? window.setTimeout(() => {
            b.classList.remove("ssp-hud-banner--show");
            b.classList.add("ssp-hud-banner--out");
            window.setTimeout(() => b.remove(), 240);
          }, dur)
        : 0;

    return {
      el: b,
      destroy() {
        window.clearTimeout(timer);
        b.remove();
      },
    };
  }

  return {
    el,
    update,
    showBanner,
    destroy() {
      el.remove();
    },
  };
}
