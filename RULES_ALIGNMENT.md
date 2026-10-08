# SUPER STAR PARTY — Mario Party 7 Rules Alignment + Our Touches

## MP7 Rules (as provided) → Implementation Status & Plan

### Setup
- 4 players, CPUs fill — **Already**: HUMAN=0, 3 CPUs. Good.
- Turn count 10–50 step 5 — **Already supported** via startMatch(..., totalTurns). UI hook needed in title or select.
- Everyone starts with 10 coins — **Already**.
- Each player picks a minigame pack — **Done**: Character select, title settings, and the pause settings share one picker (`ssp.minigamePacks`, `ssp.humanPack`, `ssp.minigameCoinMultiplier`). The host toggles which packs stay in the roulette (at least one). The human's pack is saved; CPUs draw from the packs left on, with a seed-derived stream so dice rolls do not shift. Those picks weight the roulette.
- Goal: most Stars, coins tiebreaker — **Already** in ranking().

### How a Turn Works
- Roll Dice Block, move, choose path at forks — **Already** (dice + movement + shortcut at 20→26 "Funhouse Cut").
- Passing or landing on balloons and shops triggers immediately — **Done**: Minigame balloons, stamp spaces, the Grand Prize Balloon, and shops pay, grant, or sell on pass and on land. Red, blue, green, and grumpus spaces still resolve on land only. A human shop visit waits for a choice. CPUs and `__SSP__.autoplay(true)` buy one affordable item they do not already hold (or leave without buying) with no modal, so a pass never stalls. Automatic visits pick that item with `rng` and throw orbs onto a legal space themselves.
- If two players end on same space → Tight Squeeze Bonus — **Done**: Carnival Squeeze. When a move *ends* on a space another active player already occupies, every active player on that space (the arriver and whoever was already there — 3 or 4 included) gains `settings.squeezeCoins` (2). Passing through does not pay. The moment is a "GROUP HUG!" banner, a toast, a squash, and the procedural `hug` sting. The coins are in hand before the landing effect, so they can fund a star or a shop on that same tile.
- If anyone popped a Minigame Balloon → minigame after all moved — **Done**: `match.minigameTriggeredThisRound` is set when a balloon is passed or landed, and the round-end check starts a minigame only then (otherwise the round rolls on). Roulette-slice boost for the popper is still **TODO**.
- Last 5 turns: Toad (→ "Fizzy Barker") gives pity item to last place — **Done**: At the *start* of a player's turn, before the die, while `turnsLeft() <= settings.pityLastTurns` (5, counting the current turn), if `ranking()` lists them last they receive one bag item they do not already hold. `ranking()` is stars, then coins, then minigame wins; a full tie keeps player order, so the highest id is last. One player, not every tied player. The pool is the held items in `src/game/items.ts` (Mushroom, Warp Whistle, Zappy, and Star Cannon while it is in season) — not orbs, which are thrown rather than carried. The shop's one-of-each rule is the inventory limit (there is no numeric bag size); if they already hold every bag item, the Barker says the bag is full and gives nothing. The line is "Aw, tough luck kid, here's a [item] on the house!" Start-of-turn, once per that turn, so the gift can be used before the roll and a player who leaves last place mid-round does not still collect it.

### Spaces and Balloons
- Star Balloon: 10 coins per Star. Bundles up to 5. If can't pay whole bundle, discard rest. After purchase, balloon moves to new spot. — **Done**: Grand Prize Balloon at `match.starBalloonPos` (starts on space 4). 10 coins each, bundle of 1–5. Unpaid stars in the chosen bundle are discarded. Any purchase moves the balloon to a new walkable space via `rng` (Funhouse Cut gaps are excluded), with a pop, gasp, and confetti. CPUs and autoplay buy as many as they can afford, up to 5.
- Minigame Balloon: shows 5 or 10 coins. Passing pays + flags minigame. Balloon poppers get bigger roulette slice. — **Partial**: Fizzy Five Balloon (space 5, pay 5) and Grand Ten Balloon (space 16, pay 10) charge on pass and land and set the minigame flag. A player with fewer coins pays what they have and the balloon still pops. Weight boost **TODO**.
- ? Block: random item — **Current**: green events + shop. Align ? to green or add explicit.
- Event space: random (free item, coin bonus, steal, swap, move Star Balloon, etc.) — **Current**: rich green + grumpus, including Balloon Breeze (moves the Grand Prize Balloon). Good base.
- Shy Guy Shop: buy items — **Current**: Gumball Emporium. Expand stock.
- Stamp space: land/pass → collect stamp. All 3 = 30 coins jackpot (can fund star same move). — **Done**: Shy Stamp Stand (space 3, before the first star), Goomba Gallery (11), Koopa Kiosk (27). Held stamps live on `player.stamps`; completing the set pays `settings.stampJackpot` (30), clears the held set, and leaves the coins in hand so a star landed later in the same move can be bought. Lifetime count is `player.stampsCollected`.

### Minigames
- Roulette from chosen packs. — **Done**: only packs the host left on can deal. Player packs weight the slice.
- No repeat from a pack until rest used. — **Done**: a pack reshuffles only after every game in it has been dealt.
- Chosen player's pack owner gets double coins. — **Done**: one owner of the dealt pack pays ×2.
- Multiple same pack selected → payout ×N (×2/3/4). — **Done**: two, three, or four owners pay ×2, ×3, or ×4. A host multiplier (×1–×4, persisted) scales that pot again. The results card shows the real coin delta.
- 2-on-2: partner of chosen also gets double. — **TODO**: the results ceremony pays and displays only the winner, and that screen is intentionally untouched here.
- Lucky Card triples roulette odds. — **Partial**: the roulette still accepts a lucky-player list and triples that pack's weight. No Lucky Card item exists yet, so nothing puts a player on that list.

### Items (full list to implement)
- Dash Mushroom: +3 roll
- Golden Dash Mushroom: +5 roll
- Poison Mushroom: −2 rival’s roll (post-roll use)
- Double Dice: two dice
- Warp Box / Pipe: swap positions (choose)
- Dueling Glove: force duel (future minigame or direct)
- Lucky Card: triple minigame odds
- Mecha Fly Guy: steal item
- Swap Card: trade items
- Boo Bell: steal rival’s Star
- Genie Lamp: warp to Star Balloon
- Chomp Call: drag Star Balloon with Chain Chomp
- Bowser Suit: stomp rival, steal Stars; if before they move, they lose turn

**Current items**: Mushroom (double roll), Warp Whistle, Zappy. Expand to cover the list.

### Ending
- Most Stars, coins tiebreaker — **Already**.
- Three Bonus Stars for board feats. One known category (need to define the other two) — **Current**: 2 (mini-star, coin-star). **Add Stamp Star** as third.

## Our Own Touches (Carnival / Fizzy Fairground flavor + mischievous party energy)

1. **Prize Balloon instead of Star Balloon** — **Done**: The Grand Prize Balloon floats around the midway (`match.starBalloonPos`). Buying a star pops it and reinflates it at a new spot, with a procedural gasp/pop and confetti.

2. **Carnival Packs** (3 original packs; the nine minigames we have are split across them, not 8–10 each yet):
   - **Midway Mayhem** — physical, chaotic, strength/speed (bumpers, cannon, push of war). — **In rotation.**
   - **Sideshow Shenanigans** — skill, timing, memory (drum solo, pipe puzzle, memory match). — **In rotation.**
   - **Big Top Bash** — party, silly, group chaos (cake dash, balloon pop, coin grab). — **In rotation.**
   The host can switch any pack off before the match. A switched-off pack never deals.

3. **Stamp Star** (third bonus star) — awarded to the player who collected the most (or all three) Shy Guy, Goomba, Koopa stamps. Collecting all three on one turn triggers the 30-coin "Carnival Jackpot" fanfare immediately. — **Partial**: jackpot fanfare (banner + crowd cheer) fires when the held set completes, including mid-move. `finalRanking` counts a Stamp Star from `stampsCollected` when anyone collected at least one. The finale ceremony still announces only Mini Star and Coin Star (**TODO**).

4. **Fizzy Barker Pity** — **Done**: In the last 5 turns, at the start of the last-place player's turn, the Barker gives one random bag item already in `src/game/items.ts`. "Aw, tough luck kid, here's a [item] on the house!" There is no Golden Dash item yet; Star Cannon is the late-game gift in that pool.

5. **Carnival Squeeze** — **Done**: Tight Squeeze Bonus is 2 coins for everyone on the space (not only a pair) and plays the procedural `hug` sting plus a GROUP HUG banner.

6. **Passing triggers** — **Done** for stamps, minigame balloons, the Grand Prize Balloon, and shops. Red, blue, green, and grumpus still fire only when you land.

7. **Lucky Ticket** — Our Lucky Card is a golden carnival ticket that not only triples roulette odds but also gives +1 coin on the next blue.

These keep the MP7 structure 100% faithful while making the game feel like *our* bright, mischievous carnival.

## Immediate Next Steps (small pieces)
- Core data model (done in this pass)
- BoardData space rebalance + stamp/minigame_balloon types — **Done** (this slice): 3 stamp kinds on the walked lap, 5-coin and 10-coin balloons on the walked lap. The Funhouse Cut still skips spaces 20–25, so those indices are not used for stamps or balloons.
- Economy: bundle buy + move balloon — **Done** (10 coins, up to 5, discard the unpaid remainder, balloon moves). Stamp jackpot — **Done** (30 coins, held stamps clear, coins available the same move, including a purchase on that same hop).
- Items: expand defs + effects for new MP7 items
- Turn loop: Carnival Squeeze, shop-on-pass, and Fizzy Barker pity — **Done**. Pack weighting — **Done** (roulette reads each player's pack; disabled packs never deal). Passing logic for stamps, minigame balloons, the Grand Prize Balloon, shops, and the minigame flag — **Done**.
- Minigame registry: pack support + multipliers — **Done** (rotation filter, no-repeat, owner ×N, host ×1–×4).
- Character select or new "Pack Select" moment — **Done** (same picker on character select, title settings, and pause settings).
- Bonus stars: stamp kind is in the ranking math when `stampsCollected > 0`. Finale reveal of Stamp Star — **TODO**.
- Shop: richer stock matching the list
- Our touches wired into events/happenings — Balloon Breeze (green space moves the Grand Prize Balloon) **Done**. Fizzy Barker pity **Done** (start of the last-place player's turn in the last 5 turns).

Once these land, run a full 10-turn autoplay and critic against MP7 bar for the new mechanics.
