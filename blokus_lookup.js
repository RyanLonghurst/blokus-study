// Looks up the computer's reply in the files written by export_opponent.py.
// position_code must stay identical to position_code in export_opponent.py.

const MASK64 = (1n << 64n) - 1n;
const SEED = 0x426C6F6B75730001n;   // must match SEED in export_opponent.py

function splitmix64(z) {
  z = (z + 0x9E3779B97F4A7C15n) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
  return z ^ (z >> 31n);
}

// key: the position as a BigInt, built the same way as Solver._key in blokus_solver.py
function positionCode(key) {
  let h = SEED;
  for (let i = 0n; i < 3n; i++) {
    h = splitmix64(h ^ ((key >> (64n * i)) & MASK64));
  }
  return h;
}

class ReplyTable {
  constructor(buffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    const version = view.getUint32(4, true);
    if (magic !== "BLKR" || (version !== 1 && version !== 2)) {
      throw new Error("Not an opponent file, or the wrong version.");
    }
    this.version = version;
    this.opening = view.getUint32(8, true);
    this.size = view.getUint32(12, true);
    const perPosition = version === 2 ? 11 : 10;
    if (buffer.byteLength !== 16 + perPosition * this.size) {
      throw new Error("Opponent file is the wrong length (incomplete download?).");
    }
    this.codes = new BigUint64Array(buffer, 16, this.size);
    this.replies = new Uint16Array(buffer, 16 + 8 * this.size, this.size);
    // version 2 files also hold each position's value: exact final margin, Blue minus Yellow
    this.values = version === 2 ? new Int8Array(buffer, 16 + 10 * this.size, this.size) : null;
  }

  _index(key) {
    const code = positionCode(key);
    let lo = 0, hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.codes[mid] < code) lo = mid + 1; else hi = mid;
    }
    return lo < this.size && this.codes[lo] === code ? lo : -1;
  }

  // The stored reply (an action id) for this position key, or null if it is not stored.
  reply(key) {
    const i = this._index(key);
    return i < 0 ? null : this.replies[i];
  }

  // {reply, value} for this position key (value is null in version 1 files), or null if not stored.
  lookup(key) {
    const i = this._index(key);
    if (i < 0) return null;
    return { reply: this.replies[i], value: this.values ? this.values[i] : null };
  }
}

// url: one file, or a list of parts that are joined in order (the largest files are split
// in two so each piece stays under GitHub's upload limits).
async function loadReplyTable(url) {
  const urls = Array.isArray(url) ? url : [url];
  const pieces = await Promise.all(urls.map(async u => {
    const response = await fetch(u);
    if (!response.ok) throw new Error(`Could not download ${u} (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }));
  if (pieces.length === 1) return new ReplyTable(pieces[0].buffer);
  const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) { joined.set(p, at); at += p.length; }
  return new ReplyTable(joined.buffer);
}

if (typeof module !== "undefined") {
  module.exports = { positionCode, ReplyTable, loadReplyTable };
}
