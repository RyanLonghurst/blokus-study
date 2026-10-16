# blokus-study

Experiment page for my economics dissertation: participants play 8x8 Blokus puzzles against a perfect
computer opponent and can pay for hints before each move.

- `index.html`, `experiment.js`: the study (consent, practice, instructions check, puzzles with hints, thank-you screen, payment draw, data sent via DataPipe)
- `values.js`: exact value of every legal move from the opponent files, and the hint for each position
- `blokus_engine.js`: game rules
- `blokus_lookup.js`: reads the opponent files
- `opponent_web/`: the computer's stored replies and position values for the nine openings (the largest files are split in two)

## Design (settings at the top of experiment.js)

- All 9 puzzles required, in a fixed order (`ORDER`). Setting `REQUIRED_PUZZLES` lower adds a thank-you screen part-way with the option to carry on.
- One game per puzzle. Before each move a hint price p is drawn from 0.25, 0.5, 1, 2 points: "which piece" costs p, "where" costs p, "show the move" costs 2p. On 20% of moves there are no hints.
- Stakes: each puzzle counts x1 or x2 (balanced within each person, random which). Hint prices are not multiplied.
- Score per puzzle = 20 - stakes x (points short of a win by 1) - hint costs, at least 0 (`START_POINTS`). One finished puzzle is drawn at random for payment.
- Mid-game starts are built in but off (`START_DEPTH_SHARE`).

## Testing

Add `?dev=1` for a testing bar. Options: `&order=311,41` (puzzles and order), `&puzzles=2` (required puzzles),
`&nohint=0` (hints on every move), `&stakes=2` (all puzzles at these stakes), `&depth=1` (mid-game starts).

## Before going live

1. Fill in the [square brackets] in the consent text and the payment rule.
2. Create DataPipe experiments and put their IDs in `DATAPIPE_DATA_ID` and `DATAPIPE_CONTACT_ID`.
3. Pilot with about 10 people: check hints are bought on roughly 20 to 40% of moves.
