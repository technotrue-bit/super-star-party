/**
 * Friends room.
 *
 * The host owns the seed, the pack rotation, the coin multiplier, and
 * the human pack. Clients copy that setup and then run the same board.
 * CPU seats stay on the local AI everywhere. Human choices are messages.
 * After each sync point every peer hashes snapshot(); a mismatch raises
 * a sticky error.
 *
 * The relay is BroadcastChannel unless VITE_PARTY_URL is set, in which
 * case it is the PartyServer WebSocket. The message shapes do not change.
 *
 * Boards: the host picks (the saved rule, ?board= wins) and resolves
 * "random" in buildSetup. A join lists the guest's boards as `id@rev`;
 * the host refuses a join without that list (an old client) or without
 * the host's board, so a version mismatch reads as "update the game"
 * instead of BOARD OUT OF SYNC.
 */
import { roster } from "../characters/roster";
import { match, snapshot, startMatch } from "../core/game";
import { ui } from "../ui/kit";
import { assignPlayerPacks, blankPlayedByPack, readPersistedRules } from "../minigames/packRules";
import {
  boardIds,
  boardTag,
  boardTags,
  DEFAULT_BOARD,
  isBoardId,
  resolveBoardRule,
  type BoardRule,
} from "../board/registry";
import { briefState, hashSnapshot } from "./hash";
import type { BoardChoice, MatchSetup, OfficialMinigame, PartyMessage, SeatSlot } from "./messages";
import { onlineMatch, setOnlineMatch } from "./mode";
import {
  configuredPartyUrl,
  openPartyRelay,
  partyTransport,
  type PartyRelay,
  type PartyRole,
  type PartyTransport,
} from "./relay";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Shown on a guest the host turned away for a missing or older board. */
export const UPDATE_REFUSAL = "Update the game to join this room";

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
  /** `tabs` is BroadcastChannel. `server` is the configured PartyServer URL. */
  transport: PartyTransport;
  /** Host's board rule for this room (the lobby carries it to guests). */
  board: BoardRule | null;
  /** Guest: the host's refusal text (e.g. UPDATE_REFUSAL). Null when seated or not refused. */
  refused: string | null;
  /** Host: peers turned away for a missing or older board. */
  refusedPeers: string[];
}

interface RoomState {
  code: string;
  hostId: string;
  seats: SeatSlot[];
  started: boolean;
  turns: number;
  board: BoardRule | null;
}

type Hooks = {
  onStart?: () => void;
  onLeave?: () => void;
};

let relay: PartyRelay | null = null;
let relayCode: string | null = null;
let relayRole: PartyRole | null = null;
let unlisten: (() => void) | null = null;
let joinTimer: ReturnType<typeof setInterval> | null = null;
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
let refused: string | null = null;
const refusedPeers: string[] = [];
/** Host: each seated guest's `boards` list from its join. */
const guestBoards = new Map<string, string[]>();
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

function onRelayStatus(message: string): void {
  lobbyError = message;
  clearJoinTimer();
  notify();
}

function clearJoinTimer(): void {
  if (joinTimer === null) return;
  clearInterval(joinTimer);
  joinTimer = null;
}

/**
 * Tab relay stays open across codes (messages carry the code).
 * A worker socket is one room, so a new code opens a new socket.
 */
function ensureRelay(code: string, role: PartyRole): void {
  if (!configuredPartyUrl()) {
    if (!relay) {
      relay = openPartyRelay({ code, peerId: peerId(), role, onStatus: onRelayStatus });
      unlisten = relay.listen(onMessage);
    }
    return;
  }
  if (relay && relayCode === code && relayRole === role) return;
  unlisten?.();
  unlisten = null;
  relay?.close();
  relay = openPartyRelay({ code, peerId: peerId(), role, onStatus: onRelayStatus });
  relayCode = code;
  relayRole = role;
  unlisten = relay.listen(onMessage);
}

/**
 * Probe-only: `?legacyJoin=1` makes this tab join like a client from before
 * boards (no `boards` field). Dev and CI builds only (VITE_SSP_TEST, the
 * same gate as __SSP_CONTACT__); a production build ignores it.
 */
function legacyJoin(): boolean {
  const live = import.meta.env.DEV || import.meta.env.VITE_SSP_TEST === "1" || import.meta.env.VITE_SSP_TEST === "true";
  if (!live) return false;
  try {
    return new URLSearchParams(location.search).get("legacyJoin") === "1";
  } catch {
    return false;
  }
}

function postJoin(): void {
  if (!relay || !room) return;
  if (legacyJoin()) {
    relay.post({ type: "join", code: room.code, peerId: peerId(), name: "Friend" });
    return;
  }
  relay.post({ type: "join", code: room.code, peerId: peerId(), name: "Friend", boards: boardTags() });
}

/** The host's board rule right now (saved rule, ?board= wins). */
function hostBoardRule(): BoardRule {
  return readPersistedRules().board;
}

/**
 * Board tags a guest needs for `rule`: the one board at the host's rev,
 * or every registered board when the host plays "random".
 */
function boardTagsFor(rule: BoardRule): string[] {
  if (rule === "random") return boardIds().map((id) => boardTag(id));
  return [boardTag(isBoardId(rule) ? rule : DEFAULT_BOARD)];
}

function canPlay(boards: string[] | undefined, need: string[]): boolean {
  if (!Array.isArray(boards)) return false;
  return need.every((tag) => boards.includes(tag));
}

/** The host socket can still be opening. Resend join until the lobby arrives. */
function armJoinRetry(): void {
  clearJoinTimer();
  if (!configuredPartyUrl()) return;
  let tries = 0;
  joinTimer = setInterval(() => {
    tries += 1;
    if (!room || room.seats.length > 0 || room.started || tries > 30) {
      clearJoinTimer();
      return;
    }
    postJoin();
  }, 300);
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
    transport: partyTransport(),
    board: room?.board ?? null,
    refused,
    refusedPeers: [...refusedPeers],
  };
}

export function isHost(): boolean {
  return !!room && room.hostId === peerId() && room.hostId !== "";
}

export function createRoom(): string {
  clearJoinTimer();
  lobbyError = null;
  refused = null;
  refusedPeers.length = 0;
  guestBoards.clear();
  matchOpen = false;
  const id = peerId();
  const code = randomToken(4);
  ensureRelay(code, "host");
  room = {
    code,
    hostId: id,
    started: false,
    turns: urlTurns() ?? 10,
    board: hostBoardRule(),
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
  clearJoinTimer();
  lobbyError = null;
  refused = null;
  matchOpen = false;
  ensureRelay(clean, "guest");
  room = { code: clean, hostId: "", started: false, turns: 10, seats: [], board: null };
  postJoin();
  armJoinRetry();
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
  // Joins were checked against the room's rule; recheck the resolved board
  // in case the rule changed after a guest sat down.
  const need = [boardTag(setup.board ?? DEFAULT_BOARD)];
  const stale = room.seats.find((s) => s.peerId && s.peerId !== room?.hostId && !canPlay(guestBoards.get(s.peerId), need));
  if (stale) return `${stale.name} needs to update the game to play this board.`;
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
  closeParty();
}

export function closeParty(): void {
  clearJoinTimer();
  unlisten?.();
  unlisten = null;
  relay?.close();
  relay = null;
  relayCode = null;
  relayRole = null;
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
  // The host resolves "random" once, here: from ?seed= when given, else
  // Math.random. Never the match rng. Guests just copy setup.board.
  const board = resolveBoardRule(rules.board, fromUrl === undefined ? undefined : seed);
  return {
    seed,
    turns,
    enabledPacks: [...rules.enabledPacks],
    coinMultiplier: rules.coinMultiplier,
    humanPack: rules.humanPack,
    packs: ghosts.map((g) => g.pack ?? rules.humanPack),
    seats: seats.map((seat) => ({ ...seat })),
    board,
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
  // A setup without a board (an older host) is the carnival.
  const board = isBoardId(setup.board) ? setup.board : DEFAULT_BOARD;
  startMatch(kinds, names, setup.turns, setup.seed, controllers, { board });
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

/** Host: the lobby's board choice changed (already saved). Tell the guests. */
export function announceLobbyBoard(): void {
  if (!room || room.started || !isHost()) return;
  broadcastLobby();
  notify();
}

function broadcastLobby(): void {
  if (!relay || !room) return;
  if (isHost()) room.board = hostBoardRule();
  relay.post({
    type: "lobby",
    code: room.code,
    hostId: room.hostId,
    seats: room.seats.map((seat) => ({ ...seat })),
    board: room.board ?? DEFAULT_BOARD,
  });
}

function onMessage(msg: PartyMessage): void {
  if (!room || msg.code !== room.code) return;
  // Turned away for an old build: stay out of this room's lobby and match.
  if (refused) return;
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
    if (msg.reason === "update") {
      refused = msg.message;
      room.seats = [];
      room.hostId = "";
    }
    clearJoinTimer();
    notify();
  }
}

function onJoin(msg: Extract<PartyMessage, { type: "join" }>): void {
  if (!isHost() || !room || room.started) return;
  // An old client (no `boards`) or one without the host's board at the
  // same rev would desync. Turn it away before it can take a seat.
  room.board = hostBoardRule();
  if (!canPlay(msg.boards, boardTagsFor(room.board))) {
    if (!refusedPeers.includes(msg.peerId)) refusedPeers.push(msg.peerId);
    relay?.post({
      type: "error",
      code: room.code,
      peerId: msg.peerId,
      message: UPDATE_REFUSAL,
      reason: "update",
    });
    notify();
    return;
  }
  if (room.seats.some((seat) => seat.peerId === msg.peerId)) {
    guestBoards.set(msg.peerId, [...(msg.boards ?? [])]);
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
      reason: "full",
    });
    return;
  }
  open.peerId = msg.peerId;
  open.name = msg.name || "Friend";
  guestBoards.set(msg.peerId, [...(msg.boards ?? [])]);
  broadcastLobby();
  notify();
}

function onLobby(msg: Extract<PartyMessage, { type: "lobby" }>): void {
  if (!room || isHost()) return;
  clearJoinTimer();
  room.hostId = msg.hostId;
  room.seats = msg.seats.map((seat) => ({ ...seat }));
  room.board = msg.board ?? DEFAULT_BOARD;
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
