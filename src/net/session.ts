/**
 * Friends room on the local tab relay.
 *
 * The host owns the seed, the pack rotation, the coin multiplier, and
 * the human pack. Clients copy that setup and then run the same board.
 * CPU seats stay on the local AI everywhere. Human choices are messages.
 * After each sync point every peer hashes snapshot(); a mismatch raises
 * a sticky error.
 */
import { roster } from "../characters/roster";
import { match, snapshot, startMatch } from "../core/game";
import { ui } from "../ui/kit";
import { assignPlayerPacks, blankPlayedByPack, readPersistedRules } from "../minigames/packRules";
import { briefState, hashSnapshot } from "./hash";
import type { BoardChoice, MatchSetup, OfficialMinigame, PartyMessage, SeatSlot } from "./messages";
import { onlineMatch, setOnlineMatch } from "./mode";
import { localTabRelay, type PartyRelay } from "./relay";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export interface PartyView {
  code: string | null;
  host: boolean;
  peerId: string;
  seats: SeatSlot[];
  humans: number;
  started: boolean;
  error: string | null;
  turns: number;
  online: boolean;
  desync: string | null;
  checkpoints: number;
  sent: number;
  recv: number;
}

interface RoomState {
  code: string;
  hostId: string;
  seats: SeatSlot[];
  started: boolean;
  turns: number;
}

type Hooks = {
  onStart?: () => void;
  onLeave?: () => void;
};

let relay: PartyRelay | null = null;
let unlisten: (() => void) | null = null;
let me = "";
let room: RoomState | null = null;
let lobbyError: string | null = null;
let matchOpen = false;
let inbox: BoardChoice[] = [];
let sent = 0;
let recv = 0;
let checkSeq = 0;
let desync: string | null = null;
const hashes = new Map<number, Map<string, { hash: string; brief: string }>>();
let minigameHandler: ((result: OfficialMinigame) => void) | null = null;
let pendingMinigame: OfficialMinigame | null = null;
let hooks: Hooks = {};
let leaveButton: HTMLButtonElement | null = null;
const listeners = new Set<() => void>();

function peerId(): string {
  if (!me) me = randomToken(6);
  return me;
}

function randomToken(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += LETTERS[b % LETTERS.length];
  return out;
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] || 1;
}

function urlNumber(key: string): number | undefined {
  try {
    const raw = new URLSearchParams(location.search).get(key);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function ensureRelay(): void {
  if (relay) return;
  relay = localTabRelay();
  unlisten = relay.listen(onMessage);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeParty(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setPartyHooks(next: Hooks): void {
  hooks = next;
}

export function partyView(): PartyView {
  const seats = room?.seats ?? [];
  return {
    code: room?.code ?? null,
    host: isHost(),
    peerId: peerId(),
    seats,
    humans: seats.filter((s) => s.peerId).length,
    started: room?.started ?? false,
    error: lobbyError,
    turns: room?.turns ?? 10,
    online: onlineMatch(),
    desync,
    checkpoints: checkSeq,
    sent,
    recv,
  };
}

export function isHost(): boolean {
  return !!room && room.hostId === peerId() && room.hostId !== "";
}

export function createRoom(): string {
  ensureRelay();
  lobbyError = null;
  matchOpen = false;
  const id = peerId();
  const code = randomToken(4);
  room = {
    code,
    hostId: id,
    started: false,
    turns: urlTurns() ?? 10,
    seats: [0, 1, 2, 3].map((index) => ({
      index,
      peerId: index === 0 ? id : null,
      name: index === 0 ? "Host" : "CPU",
      kind: roster[index]?.key ?? "pip",
    })),
  };
  notify();
  return code;
}

export function joinRoom(code: string): string | null {
  const clean = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (clean.length !== 4) return "Enter the 4-letter code.";
  ensureRelay();
  lobbyError = null;
  matchOpen = false;
  room = { code: clean, hostId: "", started: false, turns: 10, seats: [] };
  relay?.post({ type: "join", code: clean, peerId: peerId(), name: "Friend" });
  notify();
  return null;
}

export function cycleSeatKind(index: number): void {
  if (!room || room.started) return;
  const seat = room.seats[index];
  if (!seat) return;
  const mine = seat.peerId === peerId();
  const cpu = seat.peerId === null;
  if (!mine && !(isHost() && cpu)) return;
  const at = roster.findIndex((c) => c.key === seat.kind);
  const next = roster[(at + 1 + roster.length) % roster.length]?.key ?? seat.kind;
  if (isHost()) {
    seat.kind = next;
    broadcastLobby();
    notify();
    return;
  }
  relay?.post({ type: "seat", code: room.code, peerId: peerId(), kind: next });
}

export function setPlannedTurns(turns: number): void {
  if (!room || !isHost() || room.started) return;
  room.turns = turns;
  notify();
}

export function startFromLobby(): string | null {
  if (!room || !isHost()) return "Only the host can start.";
  if (room.started) return "Already started.";
  const humans = room.seats.filter((s) => s.peerId).length;
  if (humans < 2) return "Need at least two humans.";
  if (humans > 4) return "Four humans is the cap.";
  const setup = buildSetup();
  room.started = true;
  relay?.post({ type: "start", code: room.code, setup });
  applySetup(setup);
  return null;
}

export function publishChoice(choice: BoardChoice): void {
  if (!onlineMatch() || !relay || !room) return;
  sent += 1;
  relay.post({ type: "choice", code: room.code, choice });
}

export function peekChoice(): BoardChoice | null {
  return inbox[0] ?? null;
}

export function shiftChoice(): BoardChoice | null {
  return inbox.shift() ?? null;
}

export function checkpoint(label: string): void {
  if (!onlineMatch() || !relay || !room) return;
  checkSeq += 1;
  const state = snapshot();
  const hash = hashSnapshot(state);
  const brief = briefState(state);
  recordHash(checkSeq, peerId(), hash, brief);
  relay.post({
    type: "hash",
    code: room.code,
    seq: checkSeq,
    hash,
    peerId: peerId(),
    brief,
    label,
  });
  compareHashes(checkSeq);
}

export function publishMinigame(result: OfficialMinigame): void {
  if (!relay || !room) return;
  relay.post({ type: "minigame", code: room.code, result });
}

export function onOfficialMinigame(fn: (result: OfficialMinigame) => void): void {
  minigameHandler = fn;
  if (pendingMinigame) {
    const result = pendingMinigame;
    pendingMinigame = null;
    fn(result);
  }
}

export function dropOut(): void {
  if (!relay || !room) return;
  const id = peerId();
  relay.post({ type: "leave", code: room.code, peerId: id });
  applyLeave(id);
}

export function closeParty(): void {
  unlisten?.();
  unlisten = null;
  relay?.close();
  relay = null;
  removeLeaveButton();
}

function urlTurns(): number | undefined {
  const n = urlNumber("turns");
  if (n === undefined) return undefined;
  const turns = Math.floor(n);
  if (turns < 1 || turns > 10) return undefined;
  return turns;
}

function buildSetup(): MatchSetup {
  const rules = readPersistedRules();
  match.enabledPacks = [...rules.enabledPacks];
  match.coinMultiplier = rules.coinMultiplier;
  match.humanPack = rules.humanPack;
  const seats = room?.seats ?? [];
  const ghosts = seats.map((seat) => ({
    controller: (seat.peerId ? "local" : "cpu") as "local" | "cpu",
    pack: undefined as string | undefined,
  }));
  const fromUrl = urlNumber("seed");
  const seed = fromUrl === undefined ? randomSeed() : Math.floor(fromUrl) || 1;
  assignPlayerPacks(seed, ghosts);
  const turns = urlTurns() ?? room?.turns ?? 10;
  return {
    seed,
    turns,
    enabledPacks: [...rules.enabledPacks],
    coinMultiplier: rules.coinMultiplier,
    humanPack: rules.humanPack,
    packs: ghosts.map((g) => g.pack ?? rules.humanPack),
    seats: seats.map((seat) => ({ ...seat })),
  };
}

function applySetup(setup: MatchSetup): void {
  if (matchOpen) return;
  matchOpen = true;
  inbox = [];
  hashes.clear();
  checkSeq = 0;
  desync = null;
  clearDesync();
  const id = peerId();
  const controllers = setup.seats.map((seat) => {
    if (!seat.peerId) return "cpu" as const;
    return seat.peerId === id ? "local" as const : "remote" as const;
  });
  const kinds = setup.seats.map((seat) => seat.kind);
  const names = setup.seats.map((seat, index) => {
    const found = roster.find((c) => c.key === seat.kind);
    return found?.name ?? `P${index + 1}`;
  });
  startMatch(kinds, names, setup.turns, setup.seed, controllers);
  match.enabledPacks = [...setup.enabledPacks];
  match.coinMultiplier = setup.coinMultiplier;
  match.humanPack = setup.humanPack;
  match.playedByPack = blankPlayedByPack();
  setup.packs.forEach((pack, index) => {
    const player = match.players[index];
    if (player) player.pack = pack;
  });
  if (room) {
    room.started = true;
    room.turns = setup.turns;
    room.seats = setup.seats.map((seat) => ({ ...seat }));
    room.hostId = room.hostId || setup.seats[0]?.peerId || "";
  }
  setOnlineMatch(true);
  mountLeaveButton();
  notify();
  hooks.onStart?.();
}

function broadcastLobby(): void {
  if (!relay || !room) return;
  relay.post({
    type: "lobby",
    code: room.code,
    hostId: room.hostId,
    seats: room.seats.map((seat) => ({ ...seat })),
  });
}

function onMessage(msg: PartyMessage): void {
  if (!room || msg.code !== room.code) return;
  if (msg.type === "join") onJoin(msg);
  else if (msg.type === "lobby") onLobby(msg);
  else if (msg.type === "seat") onSeat(msg);
  else if (msg.type === "start") applySetup(msg.setup);
  else if (msg.type === "choice") {
    recv += 1;
    inbox.push(msg.choice);
  } else if (msg.type === "hash") {
    recordHash(msg.seq, msg.peerId, msg.hash, msg.brief);
    compareHashes(msg.seq);
  } else if (msg.type === "minigame") {
    const fn = minigameHandler;
    minigameHandler = null;
    if (fn) fn(msg.result);
    else pendingMinigame = msg.result;
  } else if (msg.type === "leave") applyLeave(msg.peerId);
  else if (msg.type === "error" && msg.peerId === peerId()) {
    lobbyError = msg.message;
    notify();
  }
}

function onJoin(msg: Extract<PartyMessage, { type: "join" }>): void {
  if (!isHost() || !room || room.started) return;
  if (room.seats.some((seat) => seat.peerId === msg.peerId)) {
    broadcastLobby();
    return;
  }
  const open = room.seats.find((seat) => seat.peerId === null);
  if (!open) {
    relay?.post({
      type: "error",
      code: room.code,
      peerId: msg.peerId,
      message: "That room is full.",
    });
    return;
  }
  open.peerId = msg.peerId;
  open.name = msg.name || "Friend";
  broadcastLobby();
  notify();
}

function onLobby(msg: Extract<PartyMessage, { type: "lobby" }>): void {
  if (!room || isHost()) return;
  room.hostId = msg.hostId;
  room.seats = msg.seats.map((seat) => ({ ...seat }));
  lobbyError = null;
  notify();
}

function onSeat(msg: Extract<PartyMessage, { type: "seat" }>): void {
  if (!isHost() || !room || room.started) return;
  const seat = room.seats.find((s) => s.peerId === msg.peerId);
  if (!seat) return;
  const known = roster.some((c) => c.key === msg.kind);
  if (!known) return;
  seat.kind = msg.kind;
  broadcastLobby();
  notify();
}

function humanPeerIds(): string[] {
  if (!room) return [];
  const ids = new Set<string>();
  for (const seat of room.seats) {
    if (seat.peerId) ids.add(seat.peerId);
  }
  return [...ids];
}

function recordHash(seq: number, id: string, hash: string, brief: string): void {
  let row = hashes.get(seq);
  if (!row) {
    row = new Map();
    hashes.set(seq, row);
  }
  row.set(id, { hash, brief });
}

function compareHashes(seq: number): void {
  const row = hashes.get(seq);
  if (!row || desync) return;
  const need = humanPeerIds();
  if (need.length < 2) return;
  if (need.some((id) => !row.has(id))) return;
  const first = row.get(need[0])!;
  const mismatch = need.some((id) => row.get(id)!.hash !== first.hash);
  if (!mismatch) return;
  const detail = need
    .map((id) => {
      const entry = row.get(id)!;
      return `${id} ${entry.hash} ${entry.brief}`;
    })
    .join(" || ");
  raiseDesync(`Checkpoint ${seq} does not match. ${detail}`);
}

function raiseDesync(detail: string): void {
  desync = detail;
  console.error("[SSP] board out of sync:", detail);
  let el = document.getElementById("ssp-desync");
  if (!el) {
    el = document.createElement("div");
    el.id = "ssp-desync";
    el.setAttribute("role", "alert");
    el.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:500",
      "background:#e23d3d",
      "color:#fff8e7",
      "border-bottom:4px solid #2b1d4e",
      "padding:12px 16px",
      "font-family:Fredoka,sans-serif",
      "font-weight:700",
      "font-size:16px",
      "line-height:1.3",
      "text-align:center",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = `BOARD OUT OF SYNC — ${detail}`;
  notify();
}

function clearDesync(): void {
  document.getElementById("ssp-desync")?.remove();
}

function applyLeave(id: string): void {
  if (!room) return;
  if (id === room.hostId) {
    showNotice("Host left. This spike has no host handoff.");
    setOnlineMatch(false);
    removeLeaveButton();
    if (id === peerId()) hooks.onLeave?.();
    else hooks.onLeave?.();
    notify();
    return;
  }
  for (const seat of room.seats) {
    if (seat.peerId !== id) continue;
    seat.peerId = null;
    seat.name = "CPU";
    const player = match.players[seat.index];
    if (player) player.controller = "cpu";
    ui.toast(`${roster.find((c) => c.key === seat.kind)?.name ?? "A friend"} dropped. CPU took over.`, {
      durationMs: 2200,
    });
  }
  if (id === peerId()) {
    setOnlineMatch(false);
    removeLeaveButton();
    hooks.onLeave?.();
  }
  notify();
}

function showNotice(text: string): void {
  let el = document.getElementById("ssp-net-notice");
  if (!el) {
    el = document.createElement("div");
    el.id = "ssp-net-notice";
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:480",
      "background:#2b1d4e",
      "color:#fff8e7",
      "padding:12px 16px",
      "font-family:Fredoka,sans-serif",
      "font-weight:700",
      "text-align:center",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = text;
}

function mountLeaveButton(): void {
  if (leaveButton) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.party = "drop";
  btn.textContent = "DROP";
  btn.style.cssText = [
    "position:fixed",
    "top:calc(8px + env(safe-area-inset-top, 0px))",
    "right:8px",
    "z-index:80",
    "font-family:Fredoka,sans-serif",
    "font-weight:700",
    "background:#fff8e7",
    "color:#2b1d4e",
    "border:3px solid #2b1d4e",
    "border-radius:999px",
    "padding:6px 12px",
    "cursor:pointer",
  ].join(";");
  btn.addEventListener("click", () => dropOut());
  document.body.appendChild(btn);
  leaveButton = btn;
}

function removeLeaveButton(): void {
  leaveButton?.remove();
  leaveButton = null;
}
