"use strict";
// Blokus experiment: paying for hints against a perfect opponent.
//
// Each puzzle is one of the nine solved openings, played once (a single game) against the
// stored perfect opponent. Before every move the participant can buy hints: which piece,
// where to start it, or the whole move. The price is drawn at random for each move, and on
// some moves no hints are offered. Each puzzle also has random stakes: the result counts
// once or twice (hint prices stay the same).
//   Score for a puzzle = 20 - stakes x (points short of a win by 1) - hint costs, at least 0.
//   (The same as stakes x margin - hint costs plus a constant, so incentives are unchanged;
//   the 20-point start just keeps scores positive. A score floored at 0 should be flagged.)
// At the end one finished puzzle is drawn at random to decide payment.
//
// Puzzles come in a fixed order (ORDER) and all nine are required (REQUIRED_PUZZLES).
//
// Everything is recorded in session.events and saved in the browser, so a participant can
// close the page and carry on later. An interrupted puzzle is restored move by move with
// the same prices and hints, so reloading cannot be used to retry.

// ---------------------------------------------------------------- settings
const APP_VERSION = "hints-1.0";
const SIDES = { 311: 0, 39: 0, 230: 0, 419: 0, 243: 0, 2: 0, 41: 1, 15: 1, 6: 1 };   // 0 = Blue, 1 = Yellow
// Fixed order for everyone: easy, hard and a Yellow puzzle come first, so the required part
// covers a spread of difficulty. Change here if needed.
const ORDER = [311, 243, 41, 230, 15, 39, 2, 419, 6];
const REQUIRED_PUZZLES = 9;          // all nine (set lower to add a thank-you screen part-way)
const START_POINTS = 20;             // every puzzle starts from this score
const TARGET_MARGIN = 1;              // best possible result in every opening: a win by 1
const DATA_DIR = "opponent_web/";

// Hints: a price p is drawn for each move; "which piece" costs p, "where" costs p, the whole move 2p.
const HINT_PRICES = [0.25, 0.5, 1, 2];
const FULL_FACTOR = 2;
const NO_HINT_SHARE = 0.2;            // share of moves with no hints (a clean measure of each person's skill)
// Stakes: each puzzle's result is multiplied by one of these; hint prices are not.
// Assigned so each participant gets as close to equal numbers of each as possible.
const STAKES = [1, 2];
// Optional mid-game starts (off): share of puzzles that start after a few perfect moves each.
const START_DEPTH_SHARE = 0;
const START_EXTRA_MOVES = { default: 2, 2: 1, 41: 1 };

const COMPUTER_DELAY_MS = 700;
const STORAGE_KEY = "blokus-hints-session";   // new key: saved sessions from the old version are not mixed in
const CONTACT_KEY = "blokus-hints-contact";
const RESEARCHER_EMAIL = "ryanlonghurst05@icloud.com";
const CONSENT_VERSION = "hints-draft-1";

// DataPipe experiment IDs (pipe.jspsych.org). While empty, nothing is sent and the finish
// screen asks participants to download their file and email it.
const DATAPIPE_DATA_ID = "";
const DATAPIPE_CONTACT_ID = "";
const DATAPIPE_URL = "https://pipe.jspsych.org/api/data/";
const COLOUR = ["Blue", "Yellow"];

// Testing switches, only active with ?dev=1 in the address:
//   &order=311,41    puzzles to play, in this order
//   &puzzles=2       number of required puzzles before the thank-you screen
//   &nohint=0        share of moves without hints
//   &stakes=2        every puzzle at these stakes
//   &depth=1         every puzzle starts mid-game
//   &pipe=ID / &contactpipe=ID   DataPipe experiment IDs
const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const devNum = (k, d) => (DEV && params.has(k) && !Number.isNaN(parseFloat(params.get(k))) ? parseFloat(params.get(k)) : d);
const NO_HINT = devNum("nohint", NO_HINT_SHARE);
const DEPTH_SHARE = devNum("depth", START_DEPTH_SHARE);
const REQUIRED = Math.round(devNum("puzzles", REQUIRED_PUZZLES));
const FIXED_STAKES = devNum("stakes", null);
const PIPE = {
  data: (DEV && params.get("pipe")) || DATAPIPE_DATA_ID,
  contact: (DEV && params.get("contactpipe")) || DATAPIPE_CONTACT_ID,
};

const $ = id => document.getElementById(id);
const fmtPts = x => (Math.round(x * 100) / 100).toString();
const pts = x => `${fmtPts(x)} point${Math.abs(x) === 1 ? "" : "s"}`;
const signedPts = x => `${x > 0 ? "+" : ""}${fmtPts(x)}`;

// ---------------------------------------------------------------- randomness
function rand() { return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32; }
function pick(list) { return list[Math.floor(rand() * list.length)]; }
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint32Array(6))].map(x => chars[x % chars.length]).join("");
}

// Balanced stakes: the list of stakes repeated to cover every puzzle, then shuffled, so a
// participant gets 4 or 5 of each (and which puzzles are double is random).
function assignStakes(order) {
  if (FIXED_STAKES !== null) return Object.fromEntries(order.map(o => [o, FIXED_STAKES]));
  const pool = shuffled(STAKES);
  const list = shuffled(order.map((_, i) => pool[i % pool.length]));
  return Object.fromEntries(order.map((o, i) => [o, list[i]]));
}

// ---------------------------------------------------------------- session and log
let session = null;
let storageOk = true;
let returnVisit = false;
const nowEpoch = () => performance.timeOrigin + performance.now();

function newSession() {
  const order = DEV && params.get("order") ? params.get("order").split(",").map(Number) : [...ORDER];
  return {
    format: "blokus-hints-log", version: 1, app: APP_VERSION,
    participant: randomCode(),
    started: new Date().toISOString(),
    startEpoch: nowEpoch(),
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
    touchScreen: matchMedia("(hover: none) and (pointer: coarse)").matches,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    settings: { hintPrices: HINT_PRICES, fullFactor: FULL_FACTOR, noHintShare: NO_HINT, stakes: STAKES, startDepthShare: DEPTH_SHARE },
    order,
    requiredPuzzles: Math.min(REQUIRED, order.length),
    stakes: assignStakes(order),
    midGame: Object.fromEntries(order.map(o => [o, rand() < DEPTH_SHARE])),
    consent: null,
    practiceDone: false,
    quizPassed: false,
    round: 0,                // puzzles finished
    active: null,            // the puzzle in progress
    results: [],             // one entry per finished puzzle
    bonusDraw: null,
    finished: false,
    finalSent: false,
    sentThrough: 0,
    uploads: 0,
    events: [],
  };
}

function record(type, data = {}) {
  session.events.push({ t: Math.round((nowEpoch() - session.startEpoch) * 10) / 10, type, ...data });
  save();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    if (storageOk) { storageOk = false; $("storageNote").hidden = false; }
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.format === "blokus-hints-log") return saved;
  } catch (e) { /* nothing saved, or storage blocked */ }
  return null;
}

function download() {
  record("download");
  const blob = new Blob([JSON.stringify(session)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${session.participant}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- sending data to DataPipe
async function sendToDataPipe(experimentID, filename, text, leaving = false) {
  try {
    const body = JSON.stringify({ experimentID, filename, data: text });
    const r = await fetch(DATAPIPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body,
      keepalive: leaving && body.length < 60000,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: String(e) };
  }
}

async function uploadLog(label, leaving = false) {
  if (!PIPE.data) return false;
  session.uploads++;
  const filename = `${session.participant}_${String(session.uploads).padStart(3, "0")}_${label}.json`;
  record("upload_start", { label, filename });
  session.eventsAtUpload = session.events.length;
  const res = await sendToDataPipe(PIPE.data, filename, JSON.stringify(session), leaving);
  record(res.ok ? "upload_ok" : "upload_failed", { label, filename, status: res.status, error: res.error || null });
  if (res.ok) { session.sentThrough = Math.max(session.sentThrough || 0, session.round); save(); }
  return res.ok;
}

async function sendWithStatus(label, statusEl, fallbackEl) {
  fallbackEl.hidden = true;
  if (!PIPE.data) return fallback();
  statusEl.textContent = "Sending your results. Please keep this page open.";
  for (const wait of [0, 2000, 5000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (await uploadLog(label)) {
      statusEl.textContent = "Your results have been sent.";
      return true;
    }
  }
  return fallback();
  function fallback() {
    statusEl.textContent = "Your results could not be sent automatically.";
    fallbackEl.hidden = false;
    return false;
  }
}

let lastLeaveUpload = 0;
function uploadOnLeave() {
  if (!PIPE.data || !session || !session.consent || session.finished) return;
  const now = Date.now();
  if (now - lastLeaveUpload < 60000) return;
  if (session.events.length - (session.eventsAtUpload || 0) < 5) return;
  lastLeaveUpload = now;
  uploadLog("pause", true);
}

let pendingContact = null;
function loadContact() {
  try { return JSON.parse(localStorage.getItem(CONTACT_KEY)) || pendingContact; } catch (e) { return pendingContact; }
}
let contactSending = false;
async function sendContact() {
  const contact = loadContact();
  if (!contact || !PIPE.contact || contactSending) return;
  contactSending = true;
  const res = await sendToDataPipe(PIPE.contact, `${contact.participant}_contact_${Date.now()}.json`, JSON.stringify(contact));
  contactSending = false;
  record(res.ok ? "contact_sent" : "contact_failed", { status: res.status, error: res.error || null });
  if (res.ok) {
    pendingContact = null;
    try { localStorage.removeItem(CONTACT_KEY); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- screens
const SCREENS = ["consent", "menu", "rules", "intro", "play", "thanks", "survey", "done"];
function show(name) {
  for (const id of SCREENS) $(id).hidden = id !== name;
  record("screen", { name });
  window.scrollTo(0, 0);
}

function progressBoxes(el, current) {
  el.replaceChildren(...session.order.map((_, i) => {
    const s = document.createElement("span");
    if (i < session.round) s.className = "done";
    else if (i === session.round && current) s.className = "now";
    return s;
  }));
}

const total = () => session.order.length;
const required = () => Math.min(session.requiredPuzzles, total());
const stakesOf = opening => session.stakes[opening] ?? 1;

function stakesText(s) {
  return s === 1 ? `Normal stakes. You start with ${START_POINTS} points and lose 1 for every point your result falls short of a win by 1.`
    : `Stakes x${s}: you start with ${START_POINTS} points and lose ${s} for every point your result falls short of a win by 1. Hints cost the same as usual.`;
}

// Score for a finished puzzle: START_POINTS minus stakes x shortfall minus hint costs, at least 0.
function puzzleScore(stakes, margin, hintCost) {
  const shortfall = TARGET_MARGIN - margin;
  const raw = START_POINTS - stakes * shortfall - hintCost;
  return { shortfall, raw, points: Math.max(0, raw), floored: raw < 0 };
}

// The menu decides what comes next.
function showMenu() {
  if (session.finished) return showDone();
  if (!session.consent) return show("consent");
  const a = session.active;
  if (session.practiceDone && session.quizPassed && !a && session.round >= total()) return showSurvey(false);
  if (session.practiceDone && session.quizPassed && !a && session.round >= required()) return showThanks();
  let lead, start, extra = "";
  if (!session.practiceDone) {
    lead = "Start with a practice game to learn the controls. It does not count, and there are no hints in it.";
    start = "Start practice game";
  } else if (!session.quizPassed) {
    lead = "Practice done. Next: how hints and points work.";
    start = "How the puzzles work";
  } else if (a) {
    lead = (returnVisit ? "Welcome back. " : "") + `Puzzle ${a.index + 1} was interrupted. It carries on exactly where you left it.`;
    start = `Continue puzzle ${a.index + 1}`;
  } else {
    const n = session.round + 1;
    lead = n === 1 ? (required() < total() ? `There are ${required()} puzzles to play, and you can do more afterwards if you like. You play each puzzle once.`
      : `There are ${total()} puzzles. You play each one once, a single game of a few minutes.`)
      : `Puzzle ${n - 1} finished. ${required() - n + 1} to go.`;
    start = `Start puzzle ${n}`;
    extra = stakesText(stakesOf(session.order[session.round]));
  }
  $("menuLead").textContent = lead;
  $("menuStakes").textContent = extra;
  $("menuStakes").hidden = !extra;
  $("startBtn").textContent = start;
  $("menuLater").textContent = "You don't have to do everything in one sitting. Your progress is saved in this browser, "
    + "so you can stop and come back later on this device to carry on.";
  $("progress").hidden = !session.quizPassed;
  progressBoxes($("progress"), true);
  show("menu");
  prefetchAhead();
}

function startFromMenu() {
  if (!session.practiceDone) return startPractice();
  if (!session.quizPassed) return showQuiz();
  startRound();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function checkConsentForm() {
  const ticked = ["consentRead", "consentAge", "consentAgree"].every(id => $(id).checked);
  const noPrize = $("noPrize").checked;
  const email = $("prizeEmail").value.trim();
  $("prizeEmail").disabled = noPrize;
  let hint = "";
  if (!ticked) hint = "Please tick all three consent boxes to continue.";
  else if (!noPrize && !email) hint = "Enter an email address to be paid, or tick the box if you don't want to be.";
  else if (!noPrize && !EMAIL_PATTERN.test(email)) hint = "That email address doesn't look right.";
  $("consentHint").textContent = hint;
  $("consentBtn").disabled = hint !== "";
}

function submitConsent() {
  checkConsentForm();
  if ($("consentBtn").disabled) return;
  const prizeEntered = !$("noPrize").checked;
  if (prizeEntered) {
    const contact = { participant: session.participant, email: $("prizeEmail").value.trim(), given: new Date().toISOString() };
    pendingContact = contact;
    try { localStorage.setItem(CONTACT_KEY, JSON.stringify(contact)); } catch (e) { /* kept in memory instead */ }
  }
  session.consent = { version: CONSENT_VERSION, prizeEntered, time: new Date().toISOString() };
  record("consent", { version: CONSENT_VERSION, prizeEntered });
  $("prizeEmail").value = "";
  sendContact();
  uploadLog("consent");
  showMenu();
}

function fillRules() {
  const text = $("rulesText").content;
  for (const body of document.querySelectorAll(".rules-body")) body.replaceChildren(text.cloneNode(true));
}

// ---------------------------------------------------------------- comprehension check
const QUIZ = [
  { q: "At normal stakes you buy one hint for 0.5 points, then win the puzzle by 1. What is your score for that puzzle?",
    options: ["20", "19.5", "19", "0.5"], answer: 1, why: "A win by 1 is the best result, so nothing is lost for the result: 20 minus the hint (0.5) is 19.5." },
  { q: "At stakes x2 you buy no hints and lose by 1. That is 2 short of a win by 1. What is your score?",
    options: ["18", "16", "20", "14"], answer: 1, why: "Each point short costs 2 at stakes x2: 20 minus 2 x 2 is 16." },
  { q: "What is the best result possible in every puzzle?",
    options: ["A win by 1", "A win by 5", "A draw"], answer: 0, why: "Perfect play wins by exactly 1 in every puzzle." },
  { q: "Can a hint ever point you to a move that makes your result worse?",
    options: ["Yes, sometimes", "No, a hint always shows a move that keeps the best result still possible"], answer: 1,
    why: "Hints come from the perfect computer, so they are never wrong." },
  { q: "How many times do you play each puzzle?",
    options: ["Once", "As many times as I like"], answer: 0, why: "Each puzzle is a single game." },
  { q: "If a hint is expensive on one move, does that mean the move is a hard one?",
    options: ["Yes, expensive hints are for hard moves", "No, prices are picked at random and say nothing about the move"], answer: 1,
    why: "Prices (and moves with no hints) are picked at random, so they tell you nothing about the position." },
];

function showQuiz() {
  $("quiz").replaceChildren(...QUIZ.map((item, i) => {
    const d = document.createElement("div");
    d.className = "q";
    d.id = `q_${i}`;
    const p = document.createElement("p");
    p.className = "q-text";
    p.textContent = `${i + 1}. ${item.q}`;
    d.appendChild(p);
    item.options.forEach((opt, j) => {
      const l = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio"; r.name = `q_${i}`; r.value = j;
      l.append(r, document.createTextNode(opt));
      d.appendChild(l);
    });
    const why = document.createElement("p");
    why.className = "q-why"; why.hidden = true;
    d.appendChild(why);
    return d;
  }));
  $("quizHint").textContent = "";
  show("intro");
}

function checkQuiz() {
  const answers = QUIZ.map((_, i) => {
    const r = document.querySelector(`input[name="q_${i}"]:checked`);
    return r ? Number(r.value) : null;
  });
  if (answers.includes(null)) { $("quizHint").textContent = "Please answer every question."; return; }
  let allRight = true;
  QUIZ.forEach((item, i) => {
    const d = $(`q_${i}`), why = d.querySelector(".q-why");
    const right = answers[i] === item.answer;
    allRight = allRight && right;
    d.className = "q " + (right ? "right" : "wrong");
    why.hidden = false;
    why.textContent = right ? "Correct." : "Not quite. " + item.why + " Please change your answer.";
  });
  record("quiz", { answers, passed: allRight });
  if (!allRight) { $("quizHint").textContent = "Some answers need another look."; return; }
  session.quizPassed = true;
  save();
  showMenu();
}

// ---------------------------------------------------------------- opponent tables
// The opponent files are large (2 to 44 MB), so they are downloaded in the background as
// early as possible: from the consent page onwards, the next two puzzles in order, one file
// at a time. progress[opening] = {loaded, total} in bytes, for the loading message.
const tables = {};
const progress = {};
let manifest = null;

async function getManifest() {
  if (!manifest) manifest = await (await fetch(DATA_DIR + "manifest.json")).json();
  return manifest;
}

async function downloadParts(opening, urls, total) {
  progress[opening] = { loaded: 0, total };
  const pieces = [];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download ${url} (${response.status}).`);
    if (!response.body || !response.body.getReader) {           // older browsers: no progress
      const buf = new Uint8Array(await response.arrayBuffer());
      pieces.push(buf);
      progress[opening].loaded += buf.length;
      continue;
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
      progress[opening].loaded += value.length;
    }
  }
  const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) { joined.set(p, at); at += p.length; }
  progress[opening].loaded = progress[opening].total = joined.length;
  return joined.buffer;
}

function loadTable(opening) {
  if (!tables[opening]) {
    tables[opening] = (async () => {
      const info = (await getManifest()).openings[String(opening)];
      const urls = (info.parts || [info.file]).map(f => DATA_DIR + f);
      const table = new ReplyTable(await downloadParts(opening, urls, info.bytes));
      if (!table.values) throw new Error("This version needs opponent files with position values (version 2).");
      return table;
    })();
    tables[opening].catch(() => { delete tables[opening]; delete progress[opening]; });
  }
  return tables[opening];
}

// Downloads the current puzzle and the one after it, one file at a time, without blocking anything.
let prefetching = false;
async function prefetchAhead() {
  if (prefetching || !session || session.finished) return;
  prefetching = true;
  try {
    const start = session.active ? session.active.index : session.round;
    for (const opening of session.order.slice(start, start + 2)) {
      try { await loadTable(opening); } catch (e) { break; }   // a failure is retried when the puzzle starts
    }
  } finally {
    prefetching = false;
  }
}

function loadingLabel(opening) {
  const p = progress[opening];
  if (!p || !p.total) return "Loading puzzle";
  const pct = Math.min(99, Math.floor(100 * p.loaded / p.total));
  return `Loading puzzle: ${pct}%`;
}

// Start position for a mid-game puzzle: both sides play perfect moves (the hinted move for
// the participant, the stored reply for the computer) until the participant has made
// `extra` moves beyond the opening and it is their turn again.
function midGameMoves(opening, side, table) {
  const extra = START_EXTRA_MOVES[opening] ?? START_EXTRA_MOVES.default;
  const s = openingState(SMALL, opening);
  const moves = [];
  let made = 0;
  while (!s.gameOver) {
    let a;
    if (s.current === side) {
      if (made === extra) break;
      a = decisionInfo(s, table, side).move;
      made++;
    } else {
      a = table.lookup(positionKey(s)).reply;
    }
    s.play(a);
    moves.push(a);
  }
  return moves;
}

// ---------------------------------------------------------------- game on screen
let game = null;        // {kind: "practice" | "round", state, human, table, info, ...}
let selected = null;
let hover = null;

function startPractice() {
  game = { kind: "practice", opening: null, human: 0, table: null, attempt: 0 };
  record("practice_start");
  enterPlay();
  newPracticeGame();
}

function newPracticeGame() {
  game.attempt++;
  game.token = Symbol();
  game.state = new GameState(SMALL, 2);
  game.over = false; game.busy = false; game.lastComputer = null; game.roundResult = null;
  selected = null;
  record("attempt_start", { kind: "practice", attempt: game.attempt });
  render();
}

function endPractice() {
  game.token = null;
  session.practiceDone = true;
  record("practice_end", { attempts: game.attempt });
  game = null; selected = null;
  showMenu();
}

function rebuildState(a) {
  const s = openingState(SMALL, a.opening);
  for (const m of a.startMoves || []) s.play(m);
  for (const m of a.moves) s.play(m);
  return s;
}

function lastComputerMove(state, human) {
  for (let i = state.history.length - 1; i >= 0; i--) if (state.history[i][0] !== human) return state.history[i][1];
  return null;
}

async function startRound(btn = $("startBtn"), messageEl = $("menuLead")) {
  const resumed = !!session.active;
  const index = resumed ? session.active.index : session.round;
  const opening = session.order[index];
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingLabel(opening);
  const ticker = setInterval(() => { btn.textContent = loadingLabel(opening); }, 250);
  const waitStart = performance.now();
  let table;
  try {
    table = await loadTable(opening);
  } catch (e) {
    record("error", { problem: "could not download opponent", opening, message: String(e) });
    messageEl.textContent = "The puzzle could not be downloaded. Please check your internet connection and try again.";
    return;
  } finally {
    clearInterval(ticker);
    btn.disabled = false;
    btn.textContent = label;
  }
  const waitedMs = Math.round(performance.now() - waitStart);
  if (waitedMs > 500) record("download_wait", { opening, waitedMs });
  const side = SIDES[opening];
  if (!resumed) {
    const mid = !!session.midGame[opening];
    session.active = {
      index, opening, side: COLOUR[side], stakes: stakesOf(opening), midGame: mid,
      startMoves: mid ? midGameMoves(opening, side, table) : [],
      moves: [],          // every move since the start position, both sides
      decisions: [],      // one entry per participant decision, filled in when the move is made
      pending: null,      // the decision on screen: price drawn and hints bought so far
      hintCost: 0,
    };
  }
  const a = session.active;
  record("round_start", { round: index + 1, opening, side: a.side, stakes: a.stakes, resumed, midGame: a.midGame, startMoves: a.startMoves });
  game = { kind: "round", opening, human: side, table, attempt: 1, roundResult: null };
  game.state = rebuildState(a);
  game.token = Symbol();
  game.over = false; game.busy = false;
  game.lastComputer = lastComputerMove(game.state, side);
  if (!a.moves.length && !a.startMoves.length) game.lastComputer = null;
  selected = null;
  enterPlay();
  afterMove();
  prefetchAhead();          // next puzzle downloads while this one is played
}

// ---------------------------------------------------------------- moves
const myTurn = () => game && !game.over && !game.busy && game.state.current === game.human;

// After every move and at the start: end the game, hand over to the computer, or set up
// the participant's decision.
function afterMove() {
  const s = game.state;
  if (s.gameOver) return finishGame();
  if (s.current !== game.human) return computerTurn();
  if (game.kind === "round") prepareDecision();
  render();
}

// Works out every legal move's exact value and draws the hint price once per decision
// (kept in session.active.pending, so a reload shows the same price and hints already bought).
function prepareDecision() {
  const a = session.active, s = game.state;
  const ply = s.history.length + 1;
  const info = decisionInfo(s, game.table, game.human);
  game.info = info;
  if (!info) {
    record("error", { problem: "missing position value", opening: a.opening, moves: s.history.map(h => h[1]) });
    a.pending = { ply, noHints: true, price: null, bought: [], missing: true };
    return;
  }
  if (!a.pending || a.pending.ply !== ply) {
    const noHints = rand() < NO_HINT;
    a.pending = { ply, noHints, price: noHints ? null : pick(HINT_PRICES), bought: [], shownAt: Math.round(nowEpoch() - session.startEpoch) };
    record("decision", {
      round: a.index + 1, opening: a.opening, stakes: a.stakes, ply, noHints, price: a.pending.price,
      legal: info.legal, good: info.good, best: info.best, hintMove: info.move, hintPiece: info.piece, hintCorner: info.corner,
      values: [...info.values.entries()],
    });
  }
}

const hintPrice = kind => (kind === "full" ? FULL_FACTOR : 1) * session.active.pending.price;
const boughtKinds = () => (game && game.kind === "round" && session.active && session.active.pending ? session.active.pending.bought.map(b => b.kind) : []);

function buyHint(kind) {
  if (!myTurn() || game.kind !== "round") return;
  const a = session.active, d = a.pending;
  if (!d || d.noHints || !game.info) return;
  const have = boughtKinds();
  if (have.includes(kind) || have.includes("full")) return;
  const cost = hintPrice(kind);
  d.bought.push({ kind, cost, t: Math.round(nowEpoch() - session.startEpoch) });
  a.hintCost += cost;
  record("hint_buy", { round: a.index + 1, opening: a.opening, ply: d.ply, kind, price: d.price, cost, totalHintCost: a.hintCost });
  render();
}

function computerTurn() {
  game.busy = true;
  render();
  const token = game.token;
  const step = () => {
    if (!game || game.token !== token) return;
    const state = game.state;
    let reply;
    if (game.kind === "practice") {
      const legal = state.legalActions();
      reply = legal[Math.floor(Math.random() * legal.length)];
    } else {
      const entry = game.table.lookup(positionKey(state));
      reply = entry ? entry.reply : null;
    }
    if (reply === null || !state.isLegal(reply)) {
      record("error", { problem: "no stored reply", opening: game.opening, moves: state.history.map(h => h[1]) });
      setStatus("Something went wrong: the computer has no stored move here.");
      return;
    }
    const player = state.current;
    state.play(reply);
    game.lastComputer = reply;
    if (game.kind === "round") session.active.moves.push(reply);
    record("move", { by: "computer", player, action: reply });
    game.busy = false;
    if (!state.gameOver && state.current !== game.human) {   // participant is out: computer moves again
      game.busy = true;
      render();
      setTimeout(step, COMPUTER_DELAY_MS);
      return;
    }
    afterMove();
  };
  setTimeout(step, COMPUTER_DELAY_MS);
}

function participantMove(action, piece, orientation) {
  const state = game.state;
  const ply = state.history.length + 1;
  const info = game.info;
  const value = info ? info.values.get(action) : null;
  const cost = info ? info.best - value : null;
  record("move", { by: "participant", player: state.current, action, piece, orientation, input: inputKind, ply, value, cost });
  const a = session.active, d = a.pending || { ply, noHints: true, price: null, bought: [] };
  a.decisions.push({
    ply, noHints: d.noHints, price: d.price, bought: d.bought.map(b => b.kind), hintCost: d.bought.reduce((t, b) => t + b.cost, 0),
    legal: info ? info.legal : null, good: info ? info.good : null, best: info ? info.best : null,
    hintMove: info ? info.move : null, chosen: action, value, cost,
    followedFull: d.bought.some(b => b.kind === "full") ? action === info.move : null,
    thinkMs: d.shownAt != null ? Math.round(nowEpoch() - session.startEpoch - d.shownAt) : null,
  });
  a.pending = null;
  a.moves.push(action);
  state.play(action);
  game.info = null;
  selected = null;
  if (inputKind !== "mouse") hover = null;
  save();
  afterMove();
}

function finishGame() {
  const s = game.state;
  const sc = s.scores();
  const margin = sc[game.human] - sc[1 - game.human];
  game.over = true; game.busy = false;
  if (game.kind === "practice") {
    record("attempt_end", { kind: "practice", attempt: game.attempt, scores: sc, margin });
    return render();
  }
  const a = session.active;
  const result = {
    round: a.index + 1, opening: a.opening, side: a.side, stakes: a.stakes, midGame: a.midGame, startMoves: a.startMoves,
    margin, hintCost: a.hintCost, ...puzzleScore(a.stakes, margin, a.hintCost), moves: a.moves, decisions: a.decisions,
  };
  session.results.push(result);
  session.active = null;
  session.round++;
  record("round_end", result);
  game.roundResult = result;
  render();
  uploadLog(`round${result.round}`);
  sendContact();
}

// "Next" after a puzzle: the menu for the next required puzzle, or the thank-you screen.
function afterRound() {
  game = null; selected = null;
  if (session.round >= total()) return showSurvey(false);
  showMenu();
}

// ---------------------------------------------------------------- short questionnaire at the end
// Mainly to spot data that cannot be used as it stands: people who had played these puzzles
// before, or were told how to play them (everyone gets the same puzzles and the computer
// always plays the same way).
const SURVEY = [
  { id: "experience", q: "How much Blokus had you played before this study?", options: ["Never", "A few times", "Quite often"] },
  { id: "before", q: "Have you taken part in this study before, or played these puzzles before (for example on another device)?", options: ["No", "Yes"] },
  { id: "help", q: "Did anyone tell you how to play any of these puzzles, or did you use any help apart from the hints in the game?", options: ["No", "Yes"] },
];
let surveyEarly = false;

function showSurvey(early) {
  surveyEarly = early;
  $("surveyQs").replaceChildren(...SURVEY.map(item => {
    const d = document.createElement("div");
    d.className = "q";
    const p = document.createElement("p");
    p.className = "q-text";
    p.textContent = item.q;
    d.appendChild(p);
    item.options.forEach(opt => {
      const l = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio"; r.name = `s_${item.id}`; r.value = opt;
      l.append(r, document.createTextNode(opt));
      d.appendChild(l);
    });
    return d;
  }));
  $("surveyComment").value = "";
  $("surveyHint").textContent = "";
  show("survey");
}

function submitSurvey() {
  const answers = {};
  for (const item of SURVEY) {
    const r = document.querySelector(`input[name="s_${item.id}"]:checked`);
    if (!r) { $("surveyHint").textContent = "Please answer the three questions (the comment box is optional)."; return; }
    answers[item.id] = r.value;
  }
  answers.comment = $("surveyComment").value.trim().slice(0, 2000);
  session.survey = answers;
  record("survey", answers);
  finishSession(surveyEarly);
}

// ---------------------------------------------------------------- thanks, finish, payment draw
function showThanks() {
  const played = session.round, left = total() - played;
  const back = returnVisit;
  show("thanks");
  record("thanks_shown", { puzzles: played, returning: back });
  $("thanksTitle").textContent = back ? "Welcome back" : played === required() ? "Thank you for taking part" : `Puzzle ${played} done`;
  $("thanksLead").textContent = back ? "Thank you for coming back. You can carry on from your next puzzle."
    : played === required() ? "You have finished the required puzzles. Thank you!" : "Thank you, that really helps.";
  progressBoxes($("thanksProgress"), false);
  $("thanksCount").textContent = `${played} of ${total()} puzzles done`;
  $("thanksMoreTitle").textContent = "Can you do more?";
  $("thanksMore").textContent = "Each puzzle is a single game of a few minutes, and every one makes the study more useful, so "
    + (left === 1 ? "please play the last one if you can." : `please play as many of the remaining ${left} as you can.`)
    + " Every puzzle you finish could be the one picked for your payment.";
  $("thanksStakes").textContent = stakesText(stakesOf(session.order[session.round]));
  $("thanksLater").textContent = "You don't have to do them now. Your progress is saved in this browser, so you can take a break and come back later.";
  $("moreBtn").textContent = "Play the next puzzle";
  $("breakBtn").hidden = false;
  $("breakNote").hidden = true;
  $("thanksCode").innerHTML = `Your participant code is <span class="code">${session.participant}</span>. Keep it if you might want your data removed later.`;
  if ((session.sentThrough || 0) >= played) {
    $("thanksStatus").textContent = "Your results have been sent.";
    $("thanksFallback").hidden = true;
  } else {
    sendWithStatus(`round${played}`, $("thanksStatus"), $("thanksFallback"));
  }
}

function takeBreak() {
  record("break", { puzzles: session.round });
  const url = location.origin + location.pathname;
  $("breakLink").textContent = url;
  $("breakLink").href = url;
  $("breakBtn").hidden = true;
  $("breakNote").hidden = false;
}

// One finished puzzle is drawn at random to decide payment.
function finishSession(early) {
  if (!session.bonusDraw && session.results.length) {
    const i = Math.floor(rand() * session.results.length);
    const r = session.results[i];
    session.bonusDraw = { resultIndex: i, round: r.round, opening: r.opening, points: r.points };
    record("bonus_draw", session.bonusDraw);
  }
  session.finished = true;
  record("session_finished", { puzzles: session.round, early });
  showDone();
}

async function showDone() {
  show("done");
  const n = session.round;
  $("doneLead").textContent = (n >= total() ? `You have finished all ${total()} puzzles.` : `You played ${n} puzzle${n === 1 ? "" : "s"}.`) + " Thank you for taking part.";
  const b = session.bonusDraw;
  $("doneBonus").hidden = !b;
  if (b) $("doneBonus").textContent = `The puzzle picked for your payment: puzzle ${b.round}, with a score of ${fmtPts(b.points)} out of ${START_POINTS}.`;
  $("doneCode").innerHTML = `Your participant code is <span class="code">${session.participant}</span>. Keep it if you might want your data removed later.`;
  $("doneFallback").hidden = true;
  if (session.finalSent) {
    $("doneStatus").textContent = "Your results have been sent. You can close this page.";
    return;
  }
  if (await sendWithStatus("final", $("doneStatus"), $("doneFallback"))) {
    session.finalSent = true;
    save();
    $("doneStatus").textContent = "Your results have been sent. You can close this page.";
  }
}

// ---------------------------------------------------------------- choosing and placing
function orientationIndex(piece, shape) {
  const id = shapeId(shape);
  return ORIENTATIONS[piece].findIndex(o => shapeId(o) === id);
}

function anchorOf(shape) {
  const cr = shape.reduce((s, [r]) => s + r, 0) / shape.length;
  const cc = shape.reduce((s, [, c]) => s + c, 0) / shape.length;
  let best = shape[0], bestD = Infinity;
  for (const [r, c] of shape) {
    const d = (r - cr) ** 2 + (c - cc) ** 2;
    if (d < bestD - 1e-9) { best = [r, c]; bestD = d; }
  }
  return best;
}

function placementAt(r, c) {
  const [ar, ac] = anchorOf(selected.shape);
  const row = r - ar, col = c - ac;
  const action = SMALL.findAction(selected.piece, selected.shape, row, col);
  const cells = selected.shape.map(([dr, dc]) => [row + dr, col + dc]);
  const legal = action !== null && myTurn() && game.state.isLegal(action);
  return { row, col, action, cells, legal };
}

function selectPiece(piece) {
  if (!game || game.over || !game.state.remaining[game.human].has(piece)) return;
  if (selected && selected.piece === piece) return deselect();
  selected = { piece, shape: ORIENTATIONS[piece][0].map(c => [...c]) };
  if (inputKind !== "mouse") hover = null;
  record("select", { piece, input: inputKind });
  render();
}

function deselect() {
  if (!selected) return;
  record("deselect", { piece: selected.piece });
  selected = null;
  render();
}

function turn(kind) {
  if (!selected) return;
  if (kind === "rotate") selected.shape = rotate(selected.shape);
  else if (kind === "rotate_back") selected.shape = rotate(rotate(rotate(selected.shape)));
  else selected.shape = mirror(selected.shape);
  record(kind, { piece: selected.piece, orientation: orientationIndex(selected.piece, selected.shape) });
  render();
}

function clickCell(r, c) {
  if (!selected || !myTurn()) return;
  const p = placementAt(r, c);
  const orientation = orientationIndex(selected.piece, selected.shape);
  if (!p.legal) {
    record("place_rejected", { piece: selected.piece, orientation, row: p.row, col: p.col, action: p.action, input: inputKind });
    showMessage(p.action === null ? "That doesn't fit on the board." : "That piece can't go there.");
    return;
  }
  if (game.kind === "practice") {
    record("move", { by: "participant", player: game.state.current, action: p.action, piece: selected.piece, orientation, input: inputKind });
    game.state.play(p.action);
    selected = null;
    if (inputKind !== "mouse") hover = null;
    return afterMove();
  }
  participantMove(p.action, selected.piece, orientation);
}

let messageTimer = null;
function showMessage(text) {
  $("message").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("message").textContent = ""), 1800);
}

// ---------------------------------------------------------------- drawing
function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = cls;
}

function describeMargin(m) {
  if (m > 0) return `won by ${m}`;
  if (m < 0) return `lost by ${-m}`;
  return "drew";
}

function anchorCells(state, p) {
  const v = state.variant;
  let occupied = 0n;
  for (const m of state.masks) occupied |= m;
  let anchors;
  if (!state.hasPlayed[p]) {
    const [r, c] = state.startCells[p];
    anchors = 1n << BigInt(r * v.boardSize + c);
  } else {
    const sides = v.sideNeighbours(state.masks[p]);
    anchors = v.cornerNeighbours(state.masks[p]) & ~sides & ~occupied;
  }
  const used = new Set();
  for (const a of state.legalActions()) for (const [r, c] of v.actions[a].cells) used.add(r * v.boardSize + c);
  return new Set(v.cellsIn(anchors).filter(i => used.has(i)));
}

function miniShape(shape, colour, used = false) {
  const h = Math.max(...shape.map(([r]) => r)) + 1, w = Math.max(...shape.map(([, c]) => c)) + 1;
  const on = new Set(shape.map(([r, c]) => r * w + c));
  const grid = document.createElement("div");
  grid.className = "mini";
  grid.style.gridTemplateColumns = `repeat(${w}, auto)`;
  for (let i = 0; i < h * w; i++) {
    const s = document.createElement("span");
    if (on.has(i)) s.className = used ? "off" : `on c${colour}`;
    grid.appendChild(s);
  }
  return grid;
}

const boardCells = [];
function buildBoard() {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r; d.dataset.c = c;
      $("board").appendChild(d);
      boardCells.push(d);
    }
  }
}

function enterPlay() {
  returnVisit = false;
  $("play").className = `me-${game.human}`;
  show("play");
}

function renderHints() {
  const panel = $("hintPanel");
  if (!game || game.kind !== "round" || game.over) { panel.hidden = true; return; }
  panel.hidden = false;
  const a = session.active, d = a.pending;
  const spent = `Hints so far in this puzzle: ${pts(a.hintCost)}.`;
  if (!myTurn() || !d) {
    $("hintButtons").hidden = true;
    $("hintNote").textContent = spent;
    return;
  }
  if (d.noHints) {
    $("hintButtons").hidden = true;
    $("hintNote").textContent = (d.missing ? "Hints are not available for this move. " : "No hints on this move. ") + spent;
    return;
  }
  $("hintButtons").hidden = false;
  const have = boughtKinds(), full = have.includes("full");
  for (const [kind, id] of [["piece", "hintPieceBtn"], ["corner", "hintCornerBtn"], ["full", "hintFullBtn"]]) {
    const b = $(id);
    const bought = have.includes(kind) || (full && kind !== "full");
    b.disabled = bought;
    b.querySelector(".price").textContent = bought ? "Bought" : pts(hintPrice(kind));
  }
  $("hintNote").textContent = spent;
}

function render() {
  if (!game || !game.state) return;
  const state = game.state, me = game.human;
  const grid = state.grid();
  const ghost = new Map();
  if (selected && hover && !game.over) {
    const p = placementAt(hover[0], hover[1]);
    for (const [r, c] of p.cells) if (r >= 0 && r < 8 && c >= 0 && c < 8) ghost.set(r * 8 + c, p.legal);
  }
  const anchors = myTurn() ? anchorCells(state, me) : new Set();
  const last = new Set(game.lastComputer == null ? [] : SMALL.actions[game.lastComputer].cells.map(([r, c]) => r * 8 + c));
  // hints bought for this move
  const have = myTurn() ? boughtKinds() : [];
  const info = game.info;
  const hintFull = !!info && have.includes("full");
  const hintPiece = info && (hintFull || have.includes("piece")) ? info.piece : null;
  const hintCorner = info && (hintFull || have.includes("corner")) ? info.corner : null;
  const hintCells = new Set(hintFull ? SMALL.actions[info.move].cells.map(([r, c]) => r * 8 + c) : []);
  boardCells.forEach((d, i) => {
    const owner = grid[Math.floor(i / 8)][i % 8];
    let cls = "cell";
    if (owner !== null) cls += ` p${owner}`;
    if (ghost.has(i)) cls += ghost.get(i) ? " gl" : " gi";
    else if (owner === null && anchors.has(i)) cls += " anchor";
    if (hintCells.has(i)) cls += " hm";
    else if (i === hintCorner) cls += " hc";
    if (last.has(i)) cls += " last";
    if (d.className !== cls) d.className = cls;
  });

  const tray = $("tray");
  tray.replaceChildren();
  for (const piece of SMALL.pieces) {
    const used = !state.remaining[me].has(piece);
    const b = document.createElement("button");
    b.className = "piece" + (selected && selected.piece === piece ? " selected" : "") + (piece === hintPiece ? " hinted" : "");
    b.disabled = used || game.over;
    b.setAttribute("aria-label", `Piece ${PIECES[piece][0]}` + (piece === hintPiece ? " (hint)" : ""));
    b.appendChild(miniShape(selected && selected.piece === piece ? selected.shape : ORIENTATIONS[piece][0], me, used));
    b.addEventListener("click", () => selectPiece(piece));
    tray.appendChild(b);
  }
  $("their").replaceChildren(...SMALL.pieces.map(piece => miniShape(ORIENTATIONS[piece][0], 1 - me, !state.remaining[1 - me].has(piece))));

  if (game.kind === "practice") {
    $("roundInfo").textContent = `Practice game: you are ${COLOUR[me]}. The computer here plays randomly.`;
    $("stakesInfo").textContent = "Practice";
    $("hintSpent").textContent = "";
  } else {
    const r = game.roundResult, a = session.active;
    const round = r ? r.round : a.index + 1, stakes = r ? r.stakes : a.stakes;
    $("roundInfo").textContent = `Puzzle ${round} of ${total()}: you are ${COLOUR[me]}` + ((r ? r.midGame : a.midGame) ? " (starts mid-game)" : "");
    $("stakesInfo").textContent = stakes === 1 ? "Normal stakes" : `Stakes x${stakes}`;
    $("hintSpent").textContent = r ? "" : `Hints: ${pts(a.hintCost)}`;
  }
  if (game.over) setStatus(game.roundResult ? "Puzzle finished" : "Game over");
  else if (game.busy) setStatus(state.out[me] ? "You have no moves left. The computer plays on." : "Computer is moving", "them");
  else setStatus("Your move", "me");

  renderHints();
  renderResult();
}

function renderResult() {
  const box = $("result");
  box.hidden = !game.over;
  if (!game.over) return;
  const sc = game.state.scores();
  const margin = sc[game.human] - sc[1 - game.human];
  $("resultMain").textContent = `You ${describeMargin(margin)}.`;
  if (game.kind === "practice") {
    $("resultSub").textContent = "Play again, or go back to the menu when you are ready.";
    $("resultPoints").textContent = "";
    $("againBtn").hidden = false;
    $("practiceDoneBtn").hidden = false;
    $("nextPuzzleBtn").hidden = true;
    return;
  }
  const r = game.roundResult;
  $("resultSub").textContent = margin >= TARGET_MARGIN ? "That's the best possible result." : `The best possible result here is a win by ${TARGET_MARGIN}.`;
  const lost = r.stakes * r.shortfall;
  const parts = [];
  if (lost) parts.push(`${fmtPts(lost)} for the result` + (r.stakes > 1 ? ` at stakes x${r.stakes}` : ""));
  if (r.hintCost) parts.push(`${fmtPts(r.hintCost)} for hints`);
  $("resultPoints").textContent = `Score for this puzzle: ${fmtPts(r.points)} out of ${START_POINTS}`
    + (parts.length ? ` (lost ${parts.join(" and ")}).` : ".");
  $("againBtn").hidden = true;
  $("practiceDoneBtn").hidden = true;
  $("nextPuzzleBtn").hidden = false;
  $("nextPuzzleBtn").textContent = session.round >= total() ? "Finish" : "Next";
}

// ---------------------------------------------------------------- input
let inputKind = "mouse";
let press = null;

function cellAt(board, e) {
  const rect = board.getBoundingClientRect();
  const r = Math.floor((e.clientY - rect.top) / rect.height * 8);
  const c = Math.floor((e.clientX - rect.left) / rect.width * 8);
  return r >= 0 && r < 8 && c >= 0 && c < 8 ? [r, c] : null;
}

function setHover(h) {
  if (String(h) !== String(hover)) { hover = h; if (selected) render(); }
}

function wireBoard(board) {
  const clamp = x => Math.max(0, Math.min(7, x));
  board.addEventListener("pointermove", e => {
    if (e.pointerType === "mouse") return setHover(cellAt(board, e));
    if (!press || e.pointerId !== press.id || !selected) return;
    const cell = cellAt(board, e) || press.last;
    if (!cell) return;
    press.last = cell;
    const dr = cell[0] - press.cell[0], dc = cell[1] - press.cell[1];
    if (dr || dc) press.moved = true;
    setHover([clamp(press.hover[0] + dr), clamp(press.hover[1] + dc)]);
  });
  board.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") setHover(null); });
  board.addEventListener("pointerdown", e => {
    inputKind = e.pointerType || "mouse";
    if (e.pointerType === "mouse") return;
    const cell = cellAt(board, e);
    if (!cell) return;
    if (!selected) { if (myTurn()) showMessage("Pick one of your pieces first."); return; }
    const inShadow = !!hover && placementAt(hover[0], hover[1]).cells.some(([r, c]) => r === cell[0] && c === cell[1]);
    if (!inShadow) setHover(cell);
    press = { id: e.pointerId, cell, last: cell, hover: hover ? [...hover] : cell, moved: false, inShadow };
  });
  board.addEventListener("pointerup", e => {
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      const cell = cellAt(board, e);
      if (cell) clickCell(cell[0], cell[1]);
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.inShadow && !p.moved && selected && hover) clickCell(hover[0], hover[1]);
  });
  board.addEventListener("pointercancel", () => { press = null; });
  board.addEventListener("contextmenu", e => e.preventDefault());
}

function wireInput() {
  buildBoard();
  const board = $("board");
  wireBoard(board);
  let lastWheel = 0;
  board.addEventListener("wheel", e => {
    if (!selected) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 150) return;
    lastWheel = now;
    turn(e.deltaY > 0 ? "rotate" : "rotate_back");
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if ($("play").hidden || !$("rulesOverlay").hidden) return;
    if (e.key === "r" || e.key === "R") turn("rotate");
    else if (e.key === "f" || e.key === "F") turn("flip");
    else if (e.key === "Escape") deselect();
  });
  $("rotateBtn").addEventListener("click", () => turn("rotate"));
  $("flipBtn").addEventListener("click", () => turn("flip"));
  $("againBtn").addEventListener("click", newPracticeGame);
  $("practiceDoneBtn").addEventListener("click", endPractice);
  $("nextPuzzleBtn").addEventListener("click", afterRound);
  $("hintPieceBtn").addEventListener("click", () => buyHint("piece"));
  $("hintCornerBtn").addEventListener("click", () => buyHint("corner"));
  $("hintFullBtn").addEventListener("click", () => buyHint("full"));
  $("quizBtn").addEventListener("click", checkQuiz);
  $("moreBtn").addEventListener("click", () => { record("play_more", { puzzles: session.round }); startRound($("moreBtn"), $("thanksMore")); });
  $("finishBtn").addEventListener("click", () => showSurvey(true));
  $("surveyBtn").addEventListener("click", submitSurvey);
  $("breakBtn").addEventListener("click", takeBreak);
  $("thanksDownloadBtn").addEventListener("click", download);
  $("startBtn").addEventListener("click", startFromMenu);
  $("rulesBtn").addEventListener("click", () => { record("rules_open", { from: "menu" }); show("rules"); });
  $("rulesBack").addEventListener("click", () => { record("rules_close", { from: "menu" }); showMenu(); });
  $("playRulesBtn").addEventListener("click", () => { record("rules_open", { from: "game" }); $("rulesOverlay").hidden = false; });
  $("rulesClose").addEventListener("click", () => { record("rules_close", { from: "game" }); $("rulesOverlay").hidden = true; });
  $("doneDownloadBtn").addEventListener("click", download);
  for (const id of ["consentRead", "consentAge", "consentAgree", "noPrize"]) $(id).addEventListener("change", checkConsentForm);
  $("prizeEmail").addEventListener("input", checkConsentForm);
  $("consentBtn").addEventListener("click", submitConsent);
  for (const a of document.querySelectorAll(".researcher-email")) {
    a.textContent = RESEARCHER_EMAIL;
    a.href = `mailto:${RESEARCHER_EMAIL}?subject=Blokus study`;
  }
  document.addEventListener("visibilitychange", () => {
    record("visibility", { state: document.visibilityState });
    if (document.visibilityState === "hidden") uploadOnLeave();
  });
  window.addEventListener("blur", () => record("window_blur"));
  window.addEventListener("focus", () => record("window_focus"));
  window.addEventListener("pagehide", () => save());
}

// No zooming on phones. Safari on iPhone ignores user-scalable=no in the viewport tag,
// so pinch gestures and two-finger moves are cancelled here as well.
function blockZoom() {
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, e => e.preventDefault(), { passive: false });
  }
  document.addEventListener("touchmove", e => {
    if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault();
  }, { passive: false });
}

// ---------------------------------------------------------------- start
function main() {
  blockZoom();
  fillRules();
  wireInput();
  const saved = load();
  session = saved || newSession();
  returnVisit = !!saved && session.practiceDone && !session.finished;
  record("page_load", { resumed: !!saved });
  if (!storageOk) $("storageNote").hidden = false;
  if (saved && session.active) record("round_interrupted", { round: session.active.index + 1, opening: session.active.opening });
  if (session.finished) showDone();
  else if (!session.consent) show("consent");
  else showMenu();
  prefetchAhead();          // start downloading straight away, even on the consent page
  if (session.consent) sendContact();

  if (DEV) {
    $("devbar").hidden = false;
    $("devReset").addEventListener("click", () => {
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(CONTACT_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });
    $("devDownload").addEventListener("click", download);
  }
  // read-only view for automated tests
  window.blokusTest = { get game() { return game; }, get selected() { return selected; }, get session() { return session; }, anchorOf, orientationIndex };
}

main();
