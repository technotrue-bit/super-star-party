# SUPER STAR PARTY — Mario Party 7 Rules Alignment + Our Touches

## MP7 Rules (as provided) → Implementation Status & Plan

### Setup
- 4 players, CPUs fill — **Already**: HUMAN=0, 3 CPUs. Good.
- Turn count 10–50 step 5 — **Already supported** via startMatch(..., totalTurns). UI hook needed in title or select.
- Everyone starts with 10 coins — **Already**.
- Each player picks a minigame pack — **TODO**: Add pack picker in characterSelect or new pre-match screen. Packs weight the roulette.
- Goal: most Stars, coins tiebreaker — **Already** in ranking().

### How a Turn Works
- Roll Dice Block, move, choose path at forks — **Already** (dice + movement + shortcut at 20→26 "Funhouse Cut").
- Passing or landing on balloons and shops triggers immediately — **Partial**: Shops and stars on land. Need passing logic for balloons.
- If two players end on same space → Tight Squeeze Bonus 1 coin — **TODO**.
- If anyone popped a Minigame Balloon → minigame after all moved — **TODO** (flag in match.minigameTriggeredThisRound).
- Last 5 turns: Toad (→ "Fizzy Barker") gives pity item to last place — **TODO**.

### Spaces and Balloons
- Star Balloon: 10 coins per Star. Bundles up to 5. If can't pay whole bundle, discard rest. After purchase, balloon moves to new spot. — **Current**: Fixed 20-coin star spaces. **TODO**: Dynamic position, bundle buy, move after purchase.
- Minigame Balloon: shows 5 or 10 coins. Passing pays + flags minigame. Balloon poppers get bigger roulette slice. — **TODO**: New space type, pay on pass/land, weight boost.
- ? Block: random item — **Current**: green events + shop. Align ? to green or add explicit.
- Event space: random (free item, coin bonus, steal, swap, move Star Balloon, etc.) — **Current**: rich green + grumpus. Good base. Add "move balloon" event.
- Shy Guy Shop: buy items — **Current**: Gumball Emporium. Expand stock.
- Stamp space: land/pass → collect stamp. All 3 = 30 coins jackpot (can fund star same move). — **TODO**: New type + collection + payout.

### Minigames
- Roulette from chosen packs.
- No repeat from a pack until rest used.
- Chosen player's pack owner gets double coins.
- Multiple same pack selected → payout ×N (×2/3/4).
- 2-on-2: partner of chosen also gets double.
- Lucky Card triples roulette odds. — **Current**: basic registry. **TODO**: Full pack system + multipliers.

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

1. **Prize Balloon instead of Star Balloon** — The "Grand Prize Balloon" floats around the midway. Buying a star makes it "pop and re-inflate" at a new random spot (with a little gasp sound and confetti).

2. **Carnival Packs** (3 original packs, each 8–10 minigames themed):
   - **Midway Mayhem** — physical, chaotic, strength/speed (bumpers, cannon, push of war).
   - **Sideshow Shenanigans** — skill, timing, memory (drum solo, pipe puzzle, memory match).
   - **Big Top Bash** — party, silly, group chaos (cake dash, balloon pop, coin grab).

3. **Stamp Star** (third bonus star) — awarded to the player who collected the most (or all three) Shy Guy, Goomba, Koopa stamps. Collecting all three on one turn triggers the 30-coin "Carnival Jackpot" fanfare immediately.

4. **Fizzy Barker Pity** — In last 5 turns, the last-place player gets a random "consolation" item from the Barker (themed clown who feels bad for you). "Aw, tough luck kid… here’s a Golden Dash on the house!"

5. **Carnival Squeeze** — Tight Squeeze Bonus is 2 coins (more generous, party vibe) and plays a big "group hug" sound.

6. **Passing triggers** — Balloons and certain events fire on *passing* the space as well as landing (you get the effect while hopping by).

7. **Lucky Ticket** — Our Lucky Card is a golden carnival ticket that not only triples roulette odds but also gives +1 coin on the next blue.

These keep the MP7 structure 100% faithful while making the game feel like *our* bright, mischievous carnival.

## Immediate Next Steps (small pieces)
- Core data model (done in this pass)
- BoardData space rebalance + stamp/minigame_balloon types
- Economy: bundle buy + move balloon + stamp jackpot
- Items: expand defs + effects for new MP7 items
- Turn loop: tight squeeze, passing logic, minigame flag, pity, pack weighting
- Minigame registry: pack support + multipliers
- Character select or new "Pack Select" moment
- Bonus stars: add "stamp" kind
- Shop: richer stock matching the list
- Our touches wired into events/happenings (move balloon, fizzy pity)

Once these land, run a full 10-turn autoplay and critic against MP7 bar for the new mechanics.
