"use strict";
// Exact value of every legal move for the participant, and the hints built from them.
// Needs blokus_engine.js (GameState, SMALL, PIECE_SIZES, positionKey) and a ReplyTable
// from blokus_lookup.js loaded first.
//
// A move's value is the final margin (participant minus computer) the participant ends up
// with if both sides play perfectly after it:
//   - the move ends the game: the actual final margin;
//   - the computer moves next: the stored value of that position (opponent file);
//   - the computer is out, so the participant moves again: solved here by trying every
//     remaining move (only happens late in a game, when few pieces are left).

function finalMargin(state, human) {
  const s = state.scores();
  return s[human] - s[1 - human];
}

// Best final margin when only the participant can still move (the computer is out for good).
function solveAlone(state, human, memo = new Map()) {
  if (state.gameOver) return finalMargin(state, human);
  const key = state.masks[human].toString(16) + "|" + [...state.remaining[human]].sort((a, b) => a - b).join(",");
  if (memo.has(key)) return memo.get(key);
  let best = -Infinity;
  for (const a of state.legalActions()) {
    const child = state.copy();
    child.play(a);
    const v = child.gameOver || child.current === human ? solveAlone(child, human, memo) : NaN;
    if (Number.isNaN(v)) throw new Error("solveAlone: the computer moved again");
    if (v > best) best = v;
  }
  memo.set(key, best);
  return best;
}

// Map of action id -> exact value (participant's point of view), or null if any position
// is missing from the opponent file (then no hints are offered for this move).
function moveValues(state, table, human) {
  const values = new Map();
  for (const a of state.legalActions()) {
    const child = state.copy();
    child.play(a);
    let v;
    if (child.gameOver) v = finalMargin(child, human);
    else if (child.current !== human) {
      const entry = table.lookup(positionKey(child));
      if (!entry || entry.value === null) return null;
      v = human === 0 ? entry.value : -entry.value;
    } else v = solveAlone(child, human);
    values.set(a, v);
  }
  return values;
}

// The hinted move: among the moves that keep the best result, the biggest piece first,
// then the lowest action id (the same tie-break the computer uses), so a position always
// gives the same hint.
function hintMove(values, variant = SMALL) {
  let best = -Infinity;
  for (const v of values.values()) if (v > best) best = v;
  const keep = [...values.keys()].filter(a => values.get(a) === best);
  keep.sort((a, b) => (PIECE_SIZES[variant.actions[b].piece] - PIECE_SIZES[variant.actions[a].piece]) || a - b);
  return keep[0];
}

// The corner square for the "where" hint: the lowest-numbered starting square (a square
// touching your pieces only at a corner, or your start corner) that the hinted move covers.
function hintCorner(state, human, action) {
  const v = state.variant;
  let occupied = 0n;
  for (const m of state.masks) occupied |= m;
  let anchors;
  if (!state.hasPlayed[human]) {
    const [r, c] = state.startCells[human];
    anchors = 1n << BigInt(r * v.boardSize + c);
  } else {
    const own = state.masks[human];
    anchors = v.cornerNeighbours(own) & ~v.sideNeighbours(own) & ~occupied;
  }
  const covered = v.cellsIn(anchors & v.actions[action].mask);
  return covered.length ? covered[0] : null;
}

// Everything the hint panel and the log need for one decision.
function decisionInfo(state, table, human) {
  const values = moveValues(state, table, human);
  if (!values) return null;
  const best = Math.max(...values.values());
  const move = hintMove(values, state.variant);
  const piece = state.variant.actions[move].piece;
  const corner = hintCorner(state, human, move);
  const good = [...values.values()].filter(v => v === best).length;
  return { values, best, move, piece, corner, legal: values.size, good };
}

if (typeof module !== "undefined") {
  module.exports = { moveValues, hintMove, hintCorner, decisionInfo, solveAlone, finalMargin };
}
