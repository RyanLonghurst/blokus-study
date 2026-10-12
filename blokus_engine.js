// Blokus rules for the web page: a direct copy of blokus_engine.py.
// Same piece list, same action numbering, same legal moves, so a game played
// here can be replayed exactly in Python. Bitboards are BigInts.
// Only the Small (8x8) and Tiny (5x5) versions are built; the page needs nothing bigger.

const PIECES = [
  ["1", [[0, 0]]],
  ["2", [[0, 0], [0, 1]]],
  ["I3", [[0, 0], [0, 1], [0, 2]]],
  ["V3", [[0, 0], [1, 0], [1, 1]]],
  ["I4", [[0, 0], [0, 1], [0, 2], [0, 3]]],
  ["O4", [[0, 0], [0, 1], [1, 0], [1, 1]]],
  ["T4", [[0, 0], [0, 1], [0, 2], [1, 1]]],
  ["L4", [[0, 0], [1, 0], [2, 0], [2, 1]]],
  ["Z4", [[0, 0], [0, 1], [1, 1], [1, 2]]],
  ["F", [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]]],
  ["I5", [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]],
  ["L5", [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]],
  ["N", [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1]]],
  ["P", [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]]],
  ["T5", [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]]],
  ["U", [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]]],
  ["V5", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]],
  ["W", [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]],
  ["X", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]],
  ["Y", [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1]]],
  ["Z5", [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]]],
];
const PIECE_SIZES = PIECES.map(([, cells]) => cells.length);
const PIECE_BITS = PIECES.length;
const MIN_PLAYERS = 2, MAX_PLAYERS = 4;

// ---------------------------------------------------------------- shapes
function normalize(cells) {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells.map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
const rotate = cells => normalize(cells.map(([r, c]) => [c, -r]));   // 90 degrees clockwise
const mirror = cells => normalize(cells.map(([r, c]) => [r, -c]));   // left to right
const shapeId = cells => cells.map(([r, c]) => `${r},${c}`).join(";");

function orientations(cells) {
  const result = [], seen = new Set();
  let shape = normalize(cells);
  for (let f = 0; f < 2; f++) {
    for (let k = 0; k < 4; k++) {
      shape = rotate(shape);
      const id = shapeId(shape);
      if (!seen.has(id)) { seen.add(id); result.push(shape); }
    }
    shape = mirror(shape);
  }
  return result;
}
const ORIENTATIONS = PIECES.map(([, cells]) => orientations(cells));

// ---------------------------------------------------------------- versions
class Variant {
  constructor(name, boardSize, pieces) {
    const n = boardSize;
    this.name = name;
    this.boardSize = n;
    this.pieces = [...pieces];
    this.squaresPerPlayer = this.pieces.reduce((s, i) => s + PIECE_SIZES[i], 0);
    this.actions = [];
    this._lookup = new Map();
    this.covering = Array.from({ length: n * n }, () => []);
    for (const piece of this.pieces) {
      ORIENTATIONS[piece].forEach((shape, o) => {
        const h = Math.max(...shape.map(([r]) => r)) + 1;
        const w = Math.max(...shape.map(([, c]) => c)) + 1;
        for (let row = 0; row <= n - h; row++) {
          for (let col = 0; col <= n - w; col++) {
            const cells = shape.map(([r, c]) => [row + r, col + c]);
            let mask = 0n;
            for (const [r, c] of cells) mask |= 1n << BigInt(r * n + c);
            const id = this.actions.length;
            this.actions.push({ id, piece, orientation: o, row, col, cells, mask });
            this._lookup.set(`${piece}|${shapeId(shape)}|${row}|${col}`, id);
            for (const [r, c] of cells) this.covering[r * n + c].push(id);
          }
        }
      });
    }
    this.actionCount = this.actions.length;
    this._full = (1n << BigInt(n * n)) - 1n;
    let left = 0n;
    for (let r = 0; r < n; r++) left |= 1n << BigInt(r * n);
    this._leftCol = left;
    this._rightCol = left << BigInt(n - 1);
  }

  startCells(numPlayers) {
    const n = this.boardSize - 1;
    const corners = [[0, 0], [0, n], [n, n], [n, 0]];
    return numPlayers === 2 ? [corners[0], corners[2]] : corners.slice(0, numPlayers);
  }

  // Action id for a piece in a given shape with its top-left at (row, col), or null.
  findAction(piece, shape, row, col) {
    const id = this._lookup.get(`${piece}|${shapeId(normalize(shape))}|${row}|${col}`);
    return id === undefined ? null : id;
  }

  sideNeighbours(m) {
    const n = BigInt(this.boardSize), L = this._leftCol, R = this._rightCol;
    return (((m << 1n) & ~L) | ((m >> 1n) & ~R) | (m << n) | (m >> n)) & this._full;
  }

  cornerNeighbours(m) {
    const n = BigInt(this.boardSize), L = this._leftCol, R = this._rightCol;
    return (((m << (n + 1n)) & ~L) | ((m << (n - 1n)) & ~R)
      | ((m >> (n - 1n)) & ~L) | ((m >> (n + 1n)) & ~R)) & this._full;
  }

  cellsIn(mask) {
    const out = [];
    for (let i = 0; i < this.boardSize * this.boardSize; i++) {
      if ((mask >> BigInt(i)) & 1n) out.push(i);
    }
    return out;
  }
}

const allPieces = PIECES.map((_, i) => i);
const SMALL = new Variant("Small", 8, allPieces.filter(i => PIECE_SIZES[i] <= 4));
const TINY = new Variant("Tiny", 5, allPieces.filter(i => PIECE_SIZES[i] <= 3));

// ---------------------------------------------------------------- game state
class GameState {
  constructor(variant = SMALL, numPlayers = 2) {
    if (numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
      throw new Error(`numPlayers must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
    }
    if (variant === null) return;                 // used by copy()
    this.variant = variant;
    this.numPlayers = numPlayers;
    this.startCells = variant.startCells(numPlayers);
    this.masks = Array(numPlayers).fill(0n);
    this.remaining = Array.from({ length: numPlayers }, () => new Set(variant.pieces));
    this.hasPlayed = Array(numPlayers).fill(false);
    this.lastPiece = Array(numPlayers).fill(null);
    this.out = Array(numPlayers).fill(false);
    this.history = [];                            // [player, action id] in order played
    this.current = 0;
    this.gameOver = false;
    this._setLegal(this._computeLegal(0));
  }

  _setLegal(legal) {
    this._legal = legal;                          // sorted array of action ids
    this._legalLookup = new Set(legal);
  }

  copy() {
    const s = new GameState(null, this.numPlayers);
    s.variant = this.variant;
    s.numPlayers = this.numPlayers;
    s.startCells = this.startCells;
    s.masks = [...this.masks];
    s.remaining = this.remaining.map(r => new Set(r));
    s.hasPlayed = [...this.hasPlayed];
    s.lastPiece = [...this.lastPiece];
    s.out = [...this.out];
    s.history = this.history.map(h => [...h]);
    s.current = this.current;
    s.gameOver = this.gameOver;
    s._legal = this._legal;
    s._legalLookup = this._legalLookup;
    return s;
  }

  // ---- rules
  legalActions() { return [...this._legal]; }
  isLegal(action) { return this._legalLookup.has(action); }

  legalActionsFor(player) {
    if (player === this.current) return [...this._legal];
    if (this.out[player]) return [];
    return [...this._computeLegal(player)];
  }

  _computeLegal(p) {
    const v = this.variant;
    let occupied = 0n;
    for (const m of this.masks) occupied |= m;
    let anchors, forbidden;
    if (!this.hasPlayed[p]) {
      const [r, c] = this.startCells[p];
      anchors = (1n << BigInt(r * v.boardSize + c)) & ~occupied;
      forbidden = occupied;
    } else {
      const own = this.masks[p];
      const sides = v.sideNeighbours(own);
      anchors = v.cornerNeighbours(own) & ~sides & ~occupied;
      forbidden = occupied | sides;
    }
    const remaining = this.remaining[p];
    const found = new Set();
    for (const cell of v.cellsIn(anchors)) {
      for (const a of v.covering[cell]) {
        const act = v.actions[a];
        if (remaining.has(act.piece) && !(act.mask & forbidden)) found.add(a);
      }
    }
    return [...found].sort((a, b) => a - b);
  }

  play(action) {
    if (this.gameOver) throw new Error("The game is over.");
    if (!this.isLegal(action)) throw new Error(`Action ${action} is not legal for player ${this.current}.`);
    const p = this.current;
    const act = this.variant.actions[action];
    this.masks[p] |= act.mask;
    this.remaining[p].delete(act.piece);
    this.hasPlayed[p] = true;
    this.lastPiece[p] = act.piece;
    this.history.push([p, action]);
    this._advance();
  }

  _advance() {
    const n = this.numPlayers;
    for (let k = 1; k <= n; k++) {
      const q = (this.current + k) % n;
      if (this.out[q]) continue;
      const legal = this._computeLegal(q);
      if (legal.length) {
        this.current = q;
        this._setLegal(legal);
        return;
      }
      this.out[q] = true;
    }
    this.gameOver = true;
    this._setLegal([]);
  }

  // ---- results
  squaresLeft(player) {
    let s = 0;
    for (const i of this.remaining[player]) s += PIECE_SIZES[i];
    return s;
  }

  // -1 per square not placed; +15 for placing every piece.
  scores() {
    return this.remaining.map((r, p) => (r.size === 0 ? 15 : -this.squaresLeft(p)));
  }

  allFinished() { return this.remaining.every(r => r.size === 0); }

  winners() {
    const s = this.scores(), best = Math.max(...s);
    return s.map((v, p) => [v, p]).filter(([v]) => v === best).map(([, p]) => p);
  }

  winner() {
    const w = this.winners();
    return w.length === 1 ? w[0] : null;
  }

  resultFor(player) {
    const w = this.winners();
    if (!w.includes(player)) return -1;
    return w.length === 1 ? 1 : 0;
  }

  // ---- board views
  grid() {
    const n = this.variant.boardSize;
    const rows = Array.from({ length: n }, () => Array(n).fill(null));
    for (let p = 0; p < this.numPlayers; p++) {
      for (const cell of this.variant.cellsIn(this.masks[p])) rows[Math.floor(cell / n)][cell % n] = p;
    }
    return rows;
  }
}

// Position key, exactly as Solver._key(Solver.from_state(state)) in blokus_solver.py
// (2 players, someone to move). This is what the opponent files are looked up by.
function positionKey(state) {
  if (state.numPlayers !== 2 || state.gameOver) throw new Error("positionKey needs a 2-player game in progress.");
  const n2 = BigInt(state.variant.boardSize ** 2), bits = BigInt(PIECE_BITS);
  const rem = state.remaining.map(r => { let x = 0n; for (const i of r) x |= 1n << BigInt(i); return x; });
  return state.masks[0] | (state.masks[1] << n2) | (rem[0] << (2n * n2)) | (rem[1] << (2n * n2 + bits))
    | (BigInt(state.current) << (2n * n2 + 2n * bits));
}

// Every two-move opening as {number, blue, yellow}, numbered from 1 as in blokus_solver.openings.
function openings(variant) {
  const state = new GameState(variant, 2);
  const list = [];
  for (const b of state.legalActions()) {
    const after = state.copy();
    after.play(b);
    for (const y of after.legalActions()) list.push({ number: list.length + 1, blue: b, yellow: y });
  }
  return list;
}

// GameState after the two moves of an opening (numbered from 1).
function openingState(variant, number) {
  const op = openings(variant)[number - 1];
  const state = new GameState(variant, 2);
  state.play(op.blue);
  state.play(op.yellow);
  return state;
}

if (typeof module !== "undefined") {
  module.exports = { PIECES, PIECE_SIZES, ORIENTATIONS, Variant, SMALL, TINY, GameState,
    positionKey, openings, openingState };
}
