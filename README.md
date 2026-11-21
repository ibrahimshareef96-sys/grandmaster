# Grandmaster

A games pane that sits beside the Claude Code chat, for the minutes while Claude works.

| Game | What it does |
| --- | --- |
| Chess | Play against a built-in engine at three levels (Easy, Club, Strong). Full rules: castling, en passant, promotion, checkmate, stalemate, the fifty-move rule, threefold repetition, insufficient material. Hints, take-backs, play either colour. A rating moves with each finished game (Elo, K = 32). |
| Rubik's Cube | An unfolded 3x3 net you turn with buttons or keys (U D R L F B M, x y z; Shift for prime). Scramble starts a timed solve; the clock runs from your first turn and stops when the cube is solved. Best time and average of five are kept. An algorithm shelf (Sune, T perm, Ua perm and more) applies each one so you can drill it. |
| Solitaire | Klondike, draw 1 or draw 3. Click a card, then where it goes; click it twice to send it to a foundation. Undo, auto-play, and the last cards play themselves once everything is face up. |
| Mascot Run | An endless runner starring the Shareefico pixel mascot. Space, the up arrow or a click jumps the bugs; they speed up the longer you last. Runs and best score are kept. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install grandmaster --marketplace ibrahimshareef96-sys/grandmaster
```

Answer `y` to add the marketplace, then press Enter for the user scope. The pane opens in that session and in every session after.

From a shell:

```bash
claude plugin install grandmaster --marketplace ibrahimshareef96-sys/grandmaster
```

In the Claude desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ibrahimshareef96-sys/grandmaster`, then Add plugin.

## Use

- The pane opens beside the chat by itself when a session starts.
- `/games` reopens it. `/chess`, `/cube`, `/solitaire` and `/mascot-run` open it on that game.
- Keys 1 to 4 switch tabs while the pane has focus.
- Games in progress and your record are saved between sessions.

The boards draw in the Claude desktop app and in a terminal. In VS Code and the mobile app the pane shows your record only.

## The full version

The pane draws with text cells, so it stays simple. The same four games run as a richer web page, built from the same rule engines. Build your own copy in one step (below) and open it in any browser. The pane's "Play the full version" link points here by default; to point it at a copy you host, set the `webPage` option when you install:

```bash
claude plugin install grandmaster --marketplace ibrahimshareef96-sys/grandmaster --config webPage=https://your.site/grandmaster.html
```

The link must start with `https://` or `http://`; anything else falls back to the build steps here. Change it later with `claude plugin configure grandmaster`.

- A 3D Rubik's Cube: drag across a face to turn that layer, drag around it to spin it (it keeps your throw), every turn animated.
- Chess with drag-and-drop or click-click moves, sliding engine replies, and a rating tier.
- Klondike with drag-and-drop (a run comes with the card you grab), legal drops lit up, every card gliding into place.
- Mascot Run with the 3D Shareefico figure: hold to leap, tap to hop. He bobs as he runs, stretches as he jumps, squashes as he lands and trips forward when a bug gets him, all as motion on the approved render.

Its progress is saved in that browser, separate from the pane's record.

Build it with [Bun](https://bun.sh): `bun web/build.ts` writes `web/dist/grandmaster.html`, one self-contained file. The page uses the Satoshi font when `~/Library/Fonts/Satoshi-Variable.ttf` is installed (free from [Fontshare](https://www.fontshare.com/fonts/satoshi)) and Arial otherwise; the font is not in this repository.

## Layout

- `hooks/register.tsx`: commands, the pane, saving progress.
- `hooks/*-engine.ts`: the rules of each game, pure functions.
- `hooks/chess-ai.ts`: the chess engine (alpha-beta search with a capture search, thinking one depth per frame).
- `hooks/mascot.ts`: the mascot sprite, copied unchanged from the video mascot.
- `hooks/*-client.tsx`: the four boards.
- `web/`: the full version (`entry.ts` bundles the engines, `src/*.js` one file per game, `page.html` the styles, `build.ts` inlines everything; three.js r128 loads from cdnjs with an integrity hash).
- `tests/`: rules (including published perft counts for chess), cube turn directions, solitaire rules, a runner auto-player that proves every bug can be cleared, and the pane.

Run the checks with `claude plugin validate .` and `claude plugin test .`.
