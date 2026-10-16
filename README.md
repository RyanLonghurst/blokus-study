# blokus-study

Experiment page for my economics dissertation: participants play 8x8 Blokus puzzles against a perfect
computer opponent and can pay for hints before each move.

- `index.html`, `experiment.js`: the study (consent, tutorial video, practice game, four quick questions, puzzles with hints, leaderboard, end questionnaire, data sent via DataPipe)
- `tutorial.mp4`, `tutorial.vtt`, `tutorial_poster.jpg`: the tutorial video, its captions and its still. The practice game unlocks only when the video has played to the end (skipping forward is undone); if a browser cannot play it, the practice game unlocks and the page points to the written rules. With `?dev=1`, the testing bar has a Skip video button.
- `values.js`: exact value of every legal move from the opponent files, and the hint for each position
- `blokus_engine.js`: game rules
- `blokus_lookup.js`: reads the opponent files
- `opponent_web/`: the computer's stored replies and position values for the nine openings (the largest files are split in two)

## Design (settings at the top of experiment.js)

- All 9 puzzles required, in a random order for each participant. Setting `REQUIRED_PUZZLES` lower adds a thank-you screen part-way with the option to carry on.
- One game per puzzle. Before each move a hint price p is drawn from 0.25, 0.5, 1, 2 points: "which piece" costs p, "where" costs p, "show the move" costs 2p. On 30% of moves there are no hints.
- Stakes: each puzzle counts x1 or x2 (balanced within each person, random which). Hint prices are not multiplied.
- Score per puzzle = 20 - stakes x (points short of a win by 1) - hint costs, at least 0 (`START_POINTS`). No payment: after each puzzle a leaderboard shows the participant's rank on that puzzle and the two places above and below (anonymous random names), and an overall ranking at the end. The leaderboard is a Google Sheet with the script in `leaderboard/` (setup in `leaderboard/SETUP.md`); paste its web app address into `LEADERBOARD_URL`.
- Mid-game starts are built in but off (`START_DEPTH_SHARE`).

## Testing

Add `?dev=1` for a testing bar. Options: `&lb=URL` (leaderboard address for testing), `&order=311,41` (puzzles and order), `&puzzles=2` (required puzzles),
`&nohint=0` (hints on every move), `&stakes=2` (all puzzles at these stakes), `&depth=1` (mid-game starts).

## Before going live

1. Fill in the [square brackets] in the consent text.
2. Set up the leaderboard (`leaderboard/SETUP.md`).
3. Create DataPipe experiments and put their IDs in `DATAPIPE_DATA_ID` and `DATAPIPE_CONTACT_ID`.
4. Pilot with about 10 people: check hints are bought on roughly 20 to 40% of moves.
