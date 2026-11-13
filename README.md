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

Add `?dev=1` for a testing bar. It works only when the page is served from your own computer (localhost or
127.0.0.1, e.g. `python -m http.server`); on the public site `?dev=1` is ignored, so a shared link can't put
participants into testing mode. Options: `&lb=URL` (leaderboard address for testing), `&order=311,41` (puzzles and order), `&puzzles=2` (required puzzles),
`&nohint=0` (hints on every move), `&stakes=2` (all puzzles at these stakes), `&depth=1` (mid-game starts),
`&pipe=ID` (DataPipe experiment to send testing data to). A testing session is never sent to the live `DATAPIPE_DATA_ID`:
without `&pipe` it is not sent at all. It is marked in the data (`dev: true`, the switches in `devParams`, and `dev` on the
`page_load` and `consent` events), and on the leaderboard (test column). The testing bar's Reset session starts a new session.

## Data

Each participant's whole session (`session` in `experiment.js`: settings, results, every event) is saved in the browser
and sent to DataPipe as a full copy after consent, after each puzzle (once its leaderboard rank is in, or after 8 seconds)
and at the end, and when the page is hidden. Closing the tab can only send under about 60 KB, so if the full copy is
bigger then, a tail is sent instead (`CODE_NNN_tail.json`: only the events since the last full copy that arrived,
from `fromEvent`). Move events name their puzzle (`round`, `opening`); each decision's `awayMs` is the part of
`thinkMs` when the page was closed (reloads).

## Before going live

1. Fill in the [square brackets] in the consent text.
2. Set up the leaderboard (`leaderboard/SETUP.md`).
3. DataPipe: done. Experiment `IAvS5A40BoYi` ("Blokus hints study") saves to a private Zenodo draft
   (DataPipe no longer writes to OSF after 16 November 2026). Validation requires the `participant` and `events`
   fields, JSON only; no session limit (each participant sends many files). Don't add or delete files in the
   Zenodo draft while collecting. The consent text must name Zenodo, not OSF.
4. Pilot with about 10 people: check hints are bought on roughly 20 to 40% of moves.
