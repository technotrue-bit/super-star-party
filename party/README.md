# Friends room relay

Two ways to share a 4-letter room. The game still runs on each phone.
The relay only carries the messages in `src/net/messages.ts`.

Solo play never opens a room. With no party URL set, friends rooms stay
on the same-browser BroadcastChannel from Phase 1.

## Same-browser playtest (default)

Leave `VITE_PARTY_URL` unset.

```sh
npm run dev
```

Open `http://localhost:5177` in two tabs (or two windows) on the same machine.

1. WITH FRIENDS → CREATE ROOM in the first tab.
2. Type that 4-letter code and JOIN in the second tab.
3. The host presses START MATCH.

Both tabs share `BroadcastChannel` `ssp-party-v1` (`src/net/relay.ts`).
No Cloudflare account, no socket server, no wrangler. The lobby says
"Same-browser tabs share this room."

`node tools/net-play.mjs` drives that two-tab path while `npm run dev` is up.

## Phones on a worker (not deployed yet)

Set the worker **origin** before `npm run dev` or `npm run build`.
Vite inlines `VITE_*` at build time, so a production build needs the
variable present when `npm run build` runs.

`.env.local` (gitignored) or the shell:

```sh
VITE_PARTY_URL=https://ssp-party.<account>.workers.dev
```

An empty value is the same as unset. The client then opens:

```text
wss://ssp-party.<account>.workers.dev/parties/ssp-room/<CODE>?_pk=<peer>&role=host
```

Guests use `role=guest`. `<CODE>` is the same 4-letter code as the lobby.
The lobby says "Party server is on" when this URL is set.

`party/party-server.ts` is a PartyServer Durable Object named `SspRoom`.
It admits four sockets, refuses a fifth, and broadcasts each message to
the other sockets. It does not run the board. A socket that closes
without sending `leave` is announced with that same message, and the
host's socket closing closes the room. Seat claims and CPU takeover
stay in `src/net/session.ts`.

## Do not deploy

**Do not run `wrangler deploy`. Do not spend Cloudflare.**

`party/wrangler.toml` is a docs scaffold. It has no `account_id`, no
route, and no custom domain. It is not an npm script. CI (`.github/workflows/check.yml`)
does not call wrangler.

Deploy waits until both are true:

1. Joey's free Cloudflare account is the one that will own the worker.
2. Joey has said yes to deploy.

Until then, do not run `wrangler deploy`, `npx wrangler deploy`, or
`partykit deploy`. Do not pass `--remote` or `--tunnel`. Do not add a
deploy step to CI.

`npx wrangler dev --config party/wrangler.toml --local` only simulates
the worker on this machine. It is not an npm script, and CI does not
run it.
