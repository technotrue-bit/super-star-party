/**
 * SUPER STAR PARTY — party HUD.
 * Corner cards by seat (avatar, name, rank badge, stars, coins, minigame wins),
 * active player glows gold, plus a center-top banner slot for
 * announcements. Defensive update(): missing fields degrade gracefully.
 * Container is pointer-events none; chips are interactive.
 */
import { injectStyles } from "./styles";
import { root } from "./root";
import { playerAvatar } from "./avatar";
import { STAMP_KINDS, type StampKind } from "../core/game";
import { stampLabel } from "../board/boardText";

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
  /** True for the seat this phone controls (shows the YOU pill). */
  you?: boolean;
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
  youPill: HTMLElement;
  rankEl: HTMLElement;
  avatar: HTMLElement;
  avKey: string;
  nameEl: HTMLElement;
  coinsEl: HTMLElement;
  starsEl: HTMLElement;
  winsEl: HTMLElement;
  stampPips: HTMLElement[];
  lastCoins: number;
  lastStars: number;
}

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];

/** Standard competition ranking: stars desc, then coins desc; ties share a rank (1,1,3,4). */
export function competitionRanks(rows: { stars: number; coins: number }[]): number[] {
  return rows.map(
    (a) => 1 + rows.filter((b) => b.stars > a.stars || (b.stars === a.stars && b.coins > a.coins)).length
  );
}

function pop(el: HTMLElement): void {
  try {
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.4)", offset: 0.4 }, { transform: "scale(1)" }],
      { duration: 240, easing: "cubic-bezier(.34,1.56,.64,1)" }
    );
  } catch {
    /* noop */
  }
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function makeChip(p: HudPlayerState, idx: number): ChipRec {
  const kind = p.kind ?? "";
  const chip = document.createElement("div");
  chip.className = "ssp-hud-chip";
  chip.dataset.hudPlayer = String(p.id ?? `p${idx}`);

  const avatar = playerAvatar(kind || `player ${idx + 1}`, p.color);
  avatar.classList.add("ssp-hud-chip__avatar");
  chip.dataset.corner = CORNERS[idx % 4];
  const rankEl = document.createElement("span");
  rankEl.className = "ssp-hud-chip__rank";
  rankEl.setAttribute("aria-hidden", "true");
  chip.appendChild(rankEl);
  const youPill = document.createElement("span");
  youPill.className = "ssp-hud-chip__you";
  youPill.textContent = "YOU";
  youPill.hidden = true;
  chip.appendChild(youPill);

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
    pip.title = `${stampLabel(kind)} stamp`;
    stamps.appendChild(pip);
    return pip;
  });

  const extra = document.createElement("div");
  extra.className = "ssp-hud-chip__extra";
  stats.append(starIcon, starsEl, coinIcon, coinsEl);
  extra.append(miniIcon, winsEl, stamps);
  chip.append(avatar, nameEl, stats, extra);

  return {
    chip,
    youPill,
    rankEl,
    avatar,
    avKey: `${kind}|${p.color ?? ""}`,
    nameEl,
    coinsEl,
    starsEl,
    winsEl,
    stampPips,
    lastCoins: -1,
    lastStars: -1,
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
    const ranks = competitionRanks(
      players.map((p) => ({
        stars: Math.max(0, Math.round(p.stars ?? 0)),
        coins: Math.max(0, Math.round(p.coins ?? 0)),
      }))
    );
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
      const you = p.you === true;
      rec.youPill.hidden = !you;
      if (you) rec.chip.dataset.you = "1";
      else delete rec.chip.dataset.you;

      rec.coinsEl.textContent = String(Math.max(0, Math.round(p.coins ?? 0)));
      rec.starsEl.textContent = String(Math.max(0, Math.round(p.stars ?? 0)));
      rec.winsEl.textContent = String(Math.max(0, Math.round(p.minigameWins ?? 0)));

      const held = new Set(p.stamps ?? []);
      rec.stampPips.forEach((pip, i) => {
        const kind: StampKind = STAMP_KINDS[i];
        pip.classList.toggle("ssp-hud-stamp--on", held.has(kind));
      });

      rec.chip.classList.toggle("ssp-hud-chip--active", p.active === true);

      const rank = Math.min(4, ranks[idx]);
      rec.rankEl.dataset.rank = String(rank);
      rec.rankEl.textContent = ORDINAL[rank];

      const cv = Math.max(0, Math.round(p.coins ?? 0));
      if (rec.lastCoins >= 0 && cv !== rec.lastCoins) pop(rec.coinsEl);
      rec.lastCoins = cv;
      const sv = Math.max(0, Math.round(p.stars ?? 0));
      if (rec.lastStars >= 0 && sv !== rec.lastStars) pop(rec.starsEl);
      rec.lastStars = sv;
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
