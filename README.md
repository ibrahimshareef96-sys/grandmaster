# Grandmaster

Chess, a 3D Rubik's Cube, Klondike and Mascot Run, for the minutes while Claude Code works.

**Play now in your browser: https://ibrahimshareef96-sys.github.io/grandmaster/**

<!--SCREENSHOTS-->

- **Rubik's Cube in 3D:** drag across a face to turn that layer, drag around it to spin it (it keeps your throw), every turn animated. Timed solves, best time, average of five, an algorithm shelf to drill.
- **Chess:** drag and drop or click-click, the engine's replies slide in, three levels, a rating that moves with every game.
- **Klondike:** drag and drop (a run comes with the card you grab), legal drops light up, every card glides into place.
- **Mascot Run:** the 3D Shareefico figure runs, leaps the bugs, squashes as he lands and trips forward when one gets him. Hold to leap, tap to hop.

Progress is saved in your browser.

## In Claude Code

Install the mod and a games pane opens beside the chat at every session start. Its top line, **▶ Play the 3D version**, opens the page above on the game you are looking at. The pane itself draws with text cells (a Claude Code pane cannot run 3D or drag and drop), so its boards are the quick version, and they keep your record across sessions:

| Game | In the pane |
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

## The 3D page

The page lives in `web/` and is built from the same rule engines as the pane. GitHub Pages serves `docs/index.html`, which `bun web/build.ts --public` writes (needs [Bun](https://bun.sh)); it links the Satoshi font from [Fontshare](https://www.fontshare.com/fonts/satoshi) rather than carrying the file. `bun web/build.ts` without the flag writes `web/dist/grandmaster.html`, one self-contained file with Satoshi inlined when `~/Library/Fonts/Satoshi-Variable.ttf` is installed, for hosts that allow scripts and styles from only a few CDNs.

To send the pane's ▶ link to your own copy, set the `webPage` option when you install:

```bash
claude plugin install grandmaster --marketplace ibrahimshareef96-sys/grandmaster --config webPage=https://your.site/grandmaster.html
```

The link must start with `https://` or `http://`; anything else falls back to the page above. Change it later with `claude plugin configure grandmaster`.

## License

The code is MIT. The Shareefico mascot artwork (`web/assets/`, the sprite in `hooks/mascot.ts`) is not: see [LICENSE](LICENSE).

## Layout

- `hooks/register.tsx`: commands, the pane, saving progress.
- `hooks/*-engine.ts`: the rules of each game, pure functions.
- `hooks/chess-ai.ts`: the chess engine (alpha-beta search with a capture search, thinking one depth per frame).
- `hooks/mascot.ts`: the mascot sprite, copied unchanged from the video mascot.
- `hooks/*-client.tsx`: the four boards.
- `docs/index.html`: the built 3D page GitHub Pages serves (`bun web/build.ts --public`).
- `web/`: the 3D page's source (`entry.ts` bundles the engines, `src/*.js` one file per game, `page.html` the styles, `build.ts` inlines everything; three.js r128 loads from cdnjs with an integrity hash).
- `tests/`: rules (including published perft counts for chess), cube turn directions, solitaire rules, a runner auto-player that proves every bug can be cleared, and the pane.

Run the checks with `claude plugin validate .` and `claude plugin test .`.
