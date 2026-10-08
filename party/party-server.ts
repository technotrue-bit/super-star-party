/**
 * SUPER STAR PARTY — friends-room relay.
 *
 * DO NOT DEPLOY. Do not run `wrangler deploy`. Do not spend Cloudflare.
 * This module is not imported by the game. CI does not run wrangler.
 * See party/README.md. Deploy waits on Joey's free account and an explicit yes.
 *
 * The Durable Object forwards PartyMessage JSON between the phones in
 * one 4-letter room. It does not roll dice, hash the board, or pick seats.
 * Seat assignment, CPU takeover, and the desync banner stay in src/net/session.ts.
 * A dropped socket is announced with the same `leave` message the lobby
 * already understands. The host's socket closing closes the room.
 */
import { routePartykitRequest, Server, type Connection, type ConnectionContext } from "partyserver";
import { MAX_HUMANS, ROOM_CODE, readRelayEnvelope } from "../src/net/partyRoom";

export interface PartyEnv extends Cloudflare.Env {
  SspRoom: DurableObjectNamespace<SspRoom>;
}

export class SspRoom extends Server<PartyEnv> {
  static override options = { hibernate: false };

  /** First connection that asked to be host. In memory for the life of the sockets. */
  private hostId: string | null = null;
  /** Connections that were admitted. A rejected fifth socket is not in here. */
  private members = new Set<string>();
  /** Peers that already sent `leave`, so a later close is not a second leave. */
  private announcedLeave = new Set<string>();

  override onConnect(connection: Connection, ctx: ConnectionContext): void {
    if (this.members.size >= MAX_HUMANS) {
      this.rejectFull(connection);
      return;
    }
    this.members.add(connection.id);
    const role = new URL(ctx.request.url).searchParams.get("role");
    if (role === "host" && this.hostId === null) this.hostId = connection.id;
  }

  override onMessage(connection: Connection, message: string | ArrayBuffer | ArrayBufferView): void {
    if (!this.members.has(connection.id) || typeof message !== "string") return;
    const envelope = readRelayEnvelope(message);
    if (!envelope || envelope.code !== this.name) return;
    if (envelope.type === "leave" && envelope.peerId === connection.id) {
      this.announcedLeave.add(connection.id);
    }
    // Sender already applied the message locally, matching BroadcastChannel.
    this.broadcast(message, [connection.id]);
  }

  override onClose(connection: Connection): void {
    if (!this.members.has(connection.id)) return;
    this.members.delete(connection.id);
    if (!this.announcedLeave.has(connection.id)) {
      this.broadcast(
        JSON.stringify({ type: "leave", code: this.name, peerId: connection.id }),
        [connection.id],
      );
    }
    if (connection.id !== this.hostId) return;
    this.hostId = null;
    for (const other of this.getConnections()) {
      if (other.id === connection.id) continue;
      try {
        other.close(1000, "host left");
      } catch {
        // The socket is already gone.
      }
    }
  }

  private rejectFull(connection: Connection): void {
    const payload = JSON.stringify({
      type: "error",
      code: this.name,
      peerId: connection.id,
      message: "That room is full.",
    });
    try {
      connection.send(payload);
    } catch {
      // The socket did not accept the notice.
    }
    try {
      connection.close(1008, "room full");
    } catch {
      // Already closed.
    }
  }
}

function roomCodeError(name: string): Response | void {
  if (ROOM_CODE.test(name)) return;
  return new Response("Room codes are 4 letters.", {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: PartyEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ssp party relay\n", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect(_request, lobby) {
        return roomCodeError(lobby.name);
      },
      onBeforeRequest() {
        return new Response("This room only accepts the party WebSocket.\n", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    });
    return routed ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<PartyEnv>;
