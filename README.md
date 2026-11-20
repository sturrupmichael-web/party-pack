# Game Night Pack

A party pack for game night. A laptop on the TV hosts, and up to 8 players (plus an audience) join on
their phones and play. The games borrow familiar tabletop *mechanics*, but every name, rule wording, word
list, card and piece of art here is original.

Served at **https://michaelsturrup.com/party-pack/**:

| Page | What it is |
| --- | --- |
| `/party-pack/` | The TV: room code, QR code, lobby, game picker, the games, scores |
| `/party-pack/join/` | The phone controller (the QR code opens it with the room filled in) |

## Games

| Game | Mechanic | Players | State |
| --- | --- | --- | --- |
| 🕵️ **Mole Hunt**: everyone gets the same secret place except the mole. Ask questions out loud, accuse (it takes everyone to agree), or as the mole, name the place. | Hidden-role deduction | 3–8 | ✅ |
| 🔊 **Echo Chamber**: everyone but the guesser writes a one-word clue for a secret word; matching clues cancel out. | Co-op word clues | 3–8 | ✅ |
| 🎛️ **Dial In**: the reader gives a clue for a hidden spot on a spectrum; everyone drags a dial on their phone. | Spectrum guessing | 2–8 | ✅ |
| 🎨 **Swatch Watch**: the cue-giver picks one of four secret colours and clues it in one word, then two. Everyone marks the 24×12 grid on their phone (tap the grid, fine-tune in the zoom). On it 300, next to it 200, two away 100; the cue-giver gets 100 per mark within one cell. | Colour-grid clues | 3–8 | ✅ |
| 🗂️ **Cover Story**: two teams, 25 words. Code-givers see the key on their phone and give a word + number; their team votes on phones, and most of the team agreeing reveals a word. Find all yours first; the 🔥 Burn word loses on the spot. Winners 1000, plus 50 per word your team found. | Team word association | 4–8 | ✅ |
| 🌶️ **Hot Sauce**: everyone owns 3 mild cups and 1 hot. Stack them face down on your turn, or bid how many cups you can taste. Bids go round until all but one pass. The taster drinks their own stack first, then picks others' top cups. Make it for a win (500; two wins takes the game for +1000). Hit a hot one and lose a cup for good. | Bluff and bid | 3–8 | ✅ |
| 🍱 **Snack Swap**: everyone secretly keeps one snack from their hand and passes the rest, three rounds. 🍕 4 slices = 12, 🌮 most tacos +4, 🍟 tripled by 🥣 dip, 🥨 worth your variety, 🌶️ only pays off at 3+, 🍪 saved for the end. Snack points ×50 go to the scoreboard. Cards and rules live in `src/games/snack/content.json`. | Simultaneous drafting | 3–8 | ✅ |
| ✏️ **Doodle Relay**: everyone gets a secret prompt and draws it on their phone. Books pass along: guess the drawing, draw the guess, and so on (up to 6 steps). Then each book replays on the TV. A guess that matches what was being drawn scores 100 for guesser and drawer; a book that ends back on its prompt scores 100 for everyone in it. Prompts live in `src/games/doodle/content.json`. | Draw-and-guess chain | 3–8 | ✅ |
| 🎲 **Tumble Steps**: everyone gets 4 dice and turns go around one die at a time until everyone is out; flick from your phone (drag back to aim and set power, let go). Dice re-roll every time they tumble down a step and knock each other around. Once all dice are thrown each die scores face × its step (×1 to ×4); off the end or stuck on the launch pad scores nothing. Board points ×25 to the scoreboard. | Dexterity / physics | 2–8 | ✅ |
| 🎣 Phish or Legit (bonus): spot the scam email, link or text | Speed quiz | 1–8 | ✅ |

## How to play

1. Open `/party-pack/` on the laptop connected to the TV (⛶ goes full screen).
2. Players scan the QR code, or open `michaelsturrup.com/party-pack/join` and type the room code and a name.
3. The first player to join is the **VIP** 👑. They pick a game and press Start on their phone. The host
   keyboard does the same: <kbd>←</kbd> <kbd>→</kbd> to pick, <kbd>Enter</kbd> to start / skip / continue,
   <kbd>Esc</kbd> twice to quit a game back to the menu. During a game the VIP has Skip and Menu buttons.
4. After each game the TV shows that game's points and the running total. Continue goes back to the menu;
   nobody has to rejoin.

- **Late joiners** become the **audience**: they can play along and vote but don't score. They get a seat at
  the menu if there's room (8 seats).
- **Settings (⚙ on the TV)**: timers (Normal / Relaxed / No timer), profanity filter, sound, kick a player,
  reset scores, new room code. With **No timer**, a step waits for everyone or for Skip.
- **Kick** asks for a second click. A kicked phone can't rejoin that room.

## How it works

The architecture follows Crokinole's party mode.

- **The host is authoritative.** The TV owns the room, the game state, every timer and all scoring.
  Phones send inputs and draw whatever the host broadcasts. There's no server logic.
- **Realtime:** Supabase Realtime broadcast only, no tables. One channel per room, `partypack:<CODE>`.
  Every message is `{ v, type, from, payload, ts }` (see `src/core/protocol.ts`). The host's `state`
  message carries the public state plus each player's private slice (for example "you picked PHISH");
  secrets like the right answer only go out at the reveal.
- **Room codes** are 4 letters with no I, L, O or U, skip a blocklist of rude words, and the TV checks
  (via Realtime Presence) that nobody else is hosting a code before taking it.
- **Reconnection.** Each phone keeps a random device id per room in `localStorage`, plus the room and name, so
  a refresh or a phone waking up rejoins the same seat by itself. A new phone can take a seat back by joining
  with the same name once the old phone has been quiet for 10 seconds. Phones say hello every 4 seconds and
  show "Lost the TV…" if the host goes quiet.
- **Host refresh.** The TV saves the room and the game to `localStorage` on every change and picks up where it
  left off (same code, same round; timers are stored as deadlines). Use ⚙ → *New room code* to start fresh.
- **Rooms end** when the TV leaves: phones show "The TV has left" after a minute without it, and *New room
  code* closes the room for everyone at once.
- **Offline test mode.** Without the Supabase env vars (`VITE_SUPABASE_URL= npm run dev`) it falls back to
  `BroadcastChannel`, so the TV and the "phones" must be tabs of one browser. Handy for testing on one machine.

```
src/core/protocol.ts   Wire messages, room codes
src/core/room.ts       Players, VIP, audience, rejoin, kick, scores (pure, unit tested)
src/core/game.ts       The game interface, timer presets
src/core/profanity.ts  The name/answer filter
src/games/index.ts     The game list (picker order)
src/games/<game>/      logic.ts (pure state machine), views.ts (TV + phone), content.json
src/host/main.ts       The TV shell: lobby, picker, settings, results, timer ring
src/phone/main.ts      The phone shell: join, reconnect, VIP menu, "Look at the TV!"
src/net/               Supabase / BroadcastChannel transport, site-wide presence
src/ui/                Avatars (inline SVG), sound effects (synthesised), helpers
tests/                 Unit tests (vitest)
```

### Adding a game

Implement `GameLogic` from `src/core/game.ts`: `setup`, `onInput`, `tick`, `skip`, `isOver`, `results`,
`publicState`, `privateState`. Keep it pure (no DOM, time comes in as `ctx.now`) and its state plain JSON.
Then write a `host` and a `phone` view (each is `{ key, mount, update }`: it mounts once per key and updates in
place, so typing and animations aren't interrupted), and add it to `src/games/index.ts`.

## Adding content

Each game's prompts live in `src/games/<game>/content.json`. Edit the JSON and push; the build picks it up.

| Game | File | Format |
| --- | --- | --- |
| Mole Hunt | `src/games/mole/content.json` | `places`: `{ "name": "Ice rink", "roles": [6 roles] }`. Each game puts 20 on the board. |
| Echo Chamber | `src/games/echo/content.json` | `words`: plain strings. Pick things people can clue in one word. |
| Dial In | `src/games/dial/content.json` | `spectrums`: `["Mild", "Spicy"]` pairs, left end first. |
| Cover Story | `src/games/cover/content.json` | `words`: short common words, ideally with two meanings. Each game uses 25. |
| Swatch Watch | `src/games/swatch/grid.ts` | The grid is generated (no content file). |
| Phish or Legit | `src/games/phish/content.json` | See below. |

**Phish or Legit**: each item has

```json
{
  "id": "pl35", "kind": "email", "answer": "phish",
  "from": "Sender <someone@example.com>", "subject": "Subject line",
  "body": "The message text. Use \n for a new line.",
  "context": "Optional background line, e.g. You work at Pinecrest (pinecrest.co).",
  "clues": [{ "text": "example.com", "why": "Why this is a red flag (or why it's fine, for legit ones)." }]
}
```

- `kind` is `email` (from, subject, body), `url` (url, and body = the page title) or `sms` (from, body).
- Every clue's `text` must appear word for word in the message: the TV highlights it on the reveal.
  `npm test` checks this.
- Keep ids unique. Use made-up company names.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173/party-pack/  (phones: /party-pack/join/)
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # type-check + static build into dist/
```

To try it with real phones on your Wi-Fi, run `npm run dev` and open the "Network" address it prints on the
laptop; the QR code then points phones at your laptop.

## Deploying

Same setup as the other games on the site. Every push to `main` runs **Tests**, and when they pass
**Deploy** publishes `dist/` to GitHub Pages (Settings → Pages → Source: GitHub Actions). Because
`sturrupmichael-web.github.io` uses michaelsturrup.com, this repo is served at
`https://michaelsturrup.com/party-pack/`. The Supabase URL and publishable key are in the committed `.env`
(public by design, same project as the rest of the site).
