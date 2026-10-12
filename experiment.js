"use strict";
// Participant flow for the Blokus experiment: menu, rules, practice game, then each
// experiment opening as a timed round against the stored perfect opponent.
// Everything that happens is recorded in session.events and saved in the browser,
// so closing and reopening the page carries on where the participant left off.

// ---------------------------------------------------------------- settings
const APP_VERSION = "0.5";
// Experiment openings and the side the participant plays (0 = Blue, 1 = Yellow).
const OPENINGS = [[311, 0], [39, 0], [230, 0], [419, 0], [243, 0], [2, 0], [41, 1], [15, 1], [6, 1]];
const TARGET_MARGIN = 1;           // best possible result in every opening: a win by 1
const ROUND_MINUTES = 10;          // required time on each puzzle
const REQUIRED_PUZZLES = 1;        // puzzles everyone plays; after these, a thank-you screen offers more (up to all nine)
const COMPUTER_DELAY_MS = 700;     // pause before each computer move
const STORAGE_KEY = "blokus-experiment-session";
const CONTACT_KEY = "blokus-experiment-contact";   // prize email, kept apart from the game data
const RESEARCHER_EMAIL = "ryanlonghurst05@icloud.com";
const CONSENT_VERSION = "draft-1";                  // change whenever the consent wording changes

// DataPipe experiment IDs (from pipe.jspsych.org). Two separate experiments, so the prize
// emails go to a different OSF component from the game data. While these are empty,
// nothing is sent and the finish screen asks participants to download and email their file.
const DATAPIPE_DATA_ID = "";
const DATAPIPE_CONTACT_ID = "";
const DATAPIPE_URL = "https://pipe.jspsych.org/api/data/";
const COLOUR = ["Blue", "Yellow"];

// Testing switches, only active with ?dev=1 in the address:
//   &minutes=0.1      shorter required time
//   &order=311,41     fixed list of openings instead of a random order of all nine
//   &puzzles=2        number of required puzzles before the thank-you screen
//   &pipe=ID          DataPipe experiment ID for game data (e.g. a test experiment)
//   &contactpipe=ID   DataPipe experiment ID for prize emails
const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const devMinutes = DEV ? parseFloat(params.get("minutes")) : NaN;
const REQUIRED_MS = (devMinutes > 0 ? devMinutes : ROUND_MINUTES) * 60000;
const devPuzzles = DEV ? parseInt(params.get("puzzles"), 10) : NaN;
const REQUIRED_ROUNDS = devPuzzles > 0 ? devPuzzles : REQUIRED_PUZZLES;
const PIPE = {
  data: (DEV && params.get("pipe")) || DATAPIPE_DATA_ID,
  contact: (DEV && params.get("contactpipe")) || DATAPIPE_CONTACT_ID,
};

const $ = id => document.getElementById(id);
const sideOf = opening => OPENINGS.find(([o]) => o === opening)[1];

// ---------------------------------------------------------------- session and log
let session = null;
let storageOk = true;

const nowEpoch = () => performance.timeOrigin + performance.now();

function randomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint32Array(6))].map(x => chars[x % chars.length]).join("");
}

function shuffled(list) {
  const a = [...list];
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newSession() {
  const devOrder = DEV && params.get("order") ? params.get("order").split(",").map(Number) : null;
  return {
    format: "blokus-experiment-log", version: 1, app: APP_VERSION,
    participant: randomCode(),
    started: new Date().toISOString(),
    startEpoch: nowEpoch(),
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
    touchScreen: matchMedia("(hover: none) and (pointer: coarse)").matches,   // phone or tablet without a mouse
    maxTouchPoints: navigator.maxTouchPoints || 0,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    requiredMinutes: REQUIRED_MS / 60000,
    requiredPuzzles: REQUIRED_ROUNDS,
    order: devOrder || shuffled(OPENINGS.map(([o]) => o)),
    consent: null,            // {version, prizeEntered} once agreed; the email itself is never stored here
    practiceDone: false,
    round: 0,                 // index into order of the current or next round
    active: null,             // the round in progress, if any
    results: [],              // one entry per finished round
    finished: false,
    finalSent: false,
    sentThrough: 0,           // number of finished rounds included in the last successful upload
    uploads: 0,
    events: [],
  };
}

// t: milliseconds since the session started (continues across page reloads)
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
    if (saved && saved.format === "blokus-experiment-log") return saved;
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
async function sendToDataPipe(experimentID, filename, text) {
  try {
    const r = await fetch(DATAPIPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ experimentID, filename, data: text }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: String(e) };
  }
}

// Sends the whole log so far as a new file (DataPipe needs a new file name each time).
// The latest file for a participant contains everything in the earlier ones.
async function uploadLog(label) {
  if (!PIPE.data) return false;
  session.uploads++;
  const filename = `${session.participant}_${String(session.uploads).padStart(2, "0")}_${label}.json`;
  record("upload_start", { label, filename });
  const res = await sendToDataPipe(PIPE.data, filename, JSON.stringify(session));
  record(res.ok ? "upload_ok" : "upload_failed", { label, filename, status: res.status, error: res.error || null });
  if (res.ok) { session.sentThrough = Math.max(session.sentThrough || 0, session.round); save(); }
  return res.ok;
}

// Sends the log, trying three times, and reports progress in statusEl. If it cannot be sent
// (or DataPipe is not set up yet), fallbackEl is shown, asking the participant to download the file.
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

// The prize email is kept in its own browser storage entry (never in the game log) until it
// has been sent; if the browser cannot store it, it is held in memory instead.
let pendingContact = null;
function loadContact() {
  try { return JSON.parse(localStorage.getItem(CONTACT_KEY)) || pendingContact; } catch (e) { return pendingContact; }
}

// Sends the prize email (if any, and not yet sent) to its own DataPipe experiment, then deletes it from the browser.
let contactSending = false;
async function sendContact() {
  const contact = loadContact();
  if (!contact || !PIPE.contact || contactSending) return;
  contactSending = true;
  const filename = `${contact.participant}_contact_${Date.now()}.json`;
  const res = await sendToDataPipe(PIPE.contact, filename, JSON.stringify(contact));
  contactSending = false;
  record(res.ok ? "contact_sent" : "contact_failed", { status: res.status, error: res.error || null });
  if (res.ok) {
    pendingContact = null;
    try { localStorage.removeItem(CONTACT_KEY); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- screens
function show(name) {
  for (const id of ["consent", "menu", "rules", "play", "thanks", "done"]) $(id).hidden = id !== name;
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

function showMenu() {
  const n = session.round + 1;
  const required = Math.min(session.requiredPuzzles || REQUIRED_ROUNDS, session.order.length);
  // once the required puzzles are done, the thank-you screen takes the place of the menu
  if (session.practiceDone && !session.active && session.round >= required) return showThanks();
  let lead, start;
  if (!session.practiceDone) {
    lead = "Start with a practice game to learn the controls. It does not count.";
    start = "Start practice game";
  } else if (session.active) {
    lead = `Puzzle ${n} was interrupted. You can carry on with the time you had left.`;
    start = `Continue puzzle ${n}`;
  } else if (n === 1) {
    lead = required === 1
      ? `Practice done. Now the puzzle: you have ${ROUND_MINUTES} minutes, and can play it as many times as you like.`
      : `Practice done. There are ${required} puzzles, ${ROUND_MINUTES} minutes each.`;
    start = required === 1 ? "Start the puzzle" : "Start puzzle 1";
  } else {
    lead = `Puzzle ${n - 1} finished. ${required - n + 1} to go.`;
    start = `Start puzzle ${n}`;
  }
  $("menuLead").textContent = lead;
  $("startBtn").textContent = start;
  $("progress").hidden = session.round === 0 && !session.active;
  progressBoxes($("progress"), session.practiceDone);
  show("menu");
  if (session.practiceDone) loadTable(session.order[session.round]).catch(() => {});   // download ahead
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkConsentForm() {
  const ticked = ["consentRead", "consentAge", "consentAgree"].every(id => $(id).checked);
  const noPrize = $("noPrize").checked;
  const email = $("prizeEmail").value.trim();
  $("prizeEmail").disabled = noPrize;
  let hint = "";
  if (!ticked) hint = "Please tick all three consent boxes to continue.";
  else if (!noPrize && !email) hint = "Enter an email address to enter for a prize, or tick the box if you don't want to.";
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

function startFromMenu() {
  if (!session.practiceDone) startPractice();
  else startRound();
}

function fillRules() {
  const text = $("rulesText").content;
  for (const body of document.querySelectorAll(".rules-body")) body.replaceChildren(text.cloneNode(true));
}

// ---------------------------------------------------------------- opponent tables
const tables = {};
let manifest = null;
function loadTable(opening) {
  if (!tables[opening]) {
    tables[opening] = (async () => {
      if (!manifest) manifest = await (await fetch("opponent_web/manifest.json")).json();
      const info = manifest.openings[String(opening)];
      const table = await loadReplyTable(info.parts ? info.parts.map(f => "opponent_web/" + f) : "opponent_web/" + info.file);
      table.startValue = info.startValue ?? null;          // Blue minus Yellow, from the export
      return table;
    })();
    tables[opening].catch(() => delete tables[opening]);     // allow a retry after a failed download
  }
  return tables[opening];
}

// ---------------------------------------------------------------- rounds and timer
let game = null;        // the game on screen
let selected = null;    // piece being placed: {piece, shape}
let hover = null;       // [row, col] under the mouse
let clockTimer = null;
let lastTick = 0;
let lastSave = 0;

function startPractice() {
  game = {
    kind: "practice", opening: null, human: 0, table: null,
    attempt: 0, best: null, round: null,
  };
  record("practice_start");
  enterPlay();
}

async function startRound(btn = $("startBtn"), messageEl = $("menuLead")) {
  const index = session.round;
  const opening = session.order[index];
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Loading puzzle";
  let table;
  try {
    table = await loadTable(opening);
  } catch (e) {
    record("error", { problem: "could not download opponent", opening, message: String(e) });
    btn.disabled = false;
    messageEl.textContent = "The puzzle could not be downloaded. Please check your internet connection and try again.";
    btn.textContent = label;
    return;
  }
  btn.disabled = false;
  btn.textContent = label;
  const resumed = !!session.active;
  if (!resumed) {
    session.active = { index, opening, elapsedMs: 0, minimumReached: false, attempts: 0, best: null,
      lastScore: null, bestScore: null, attemptOpen: false };
  }
  const a = session.active;
  record("round_start", { round: index + 1, opening, side: COLOUR[sideOf(opening)], resumed, elapsedMs: Math.round(a.elapsedMs), requiredMs: REQUIRED_MS });
  game = { kind: "round", opening, human: sideOf(opening), table, attempt: a.attempts, best: a.best, round: index + 1,
    lastScore: a.lastScore ?? null, bestScore: a.bestScore ?? null };
  enterPlay();
}

function enterPlay() {
  $("play").className = `me-${game.human}`;
  show("play");
  newAttempt();
  if (game.kind === "round") {
    lastTick = performance.now();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 250);
  }
  updateClock();
}

// Runs four times a second during a round. Time counts whenever the round is on screen,
// including when the participant switches to another tab (that is logged separately).
function tick() {
  const a = session.active;
  if (!a || !game || game.kind !== "round") return;
  const now = performance.now();
  a.elapsedMs += now - lastTick;
  lastTick = now;
  if (!a.minimumReached && a.elapsedMs >= REQUIRED_MS) {
    a.minimumReached = true;
    record("minimum_reached", { round: a.index + 1, opening: a.opening });
  }
  if (now - lastSave > 1000) { lastSave = now; save(); }
  updateClock();
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateClock() {
  const isRound = game && game.kind === "round";
  const a = session.active;
  $("clock").className = "";
  if (!isRound) {
    $("clock").textContent = "Practice";
    $("timeup").hidden = true;
    return;
  }
  if (!a.minimumReached) {
    $("clock").textContent = `${fmt(REQUIRED_MS - a.elapsedMs + 999)} left`;
    $("timeup").hidden = true;
  } else {
    $("clock").textContent = `Extra time ${fmt(a.elapsedMs - REQUIRED_MS)}`;
    $("clock").className = "extra";
    const last = session.round + 1 === session.order.length;
    const moreRequired = session.round + 1 < (session.requiredPuzzles || REQUIRED_ROUNDS);
    $("timeupText").textContent = `${ROUND_MINUTES} minutes are up. You can ${moreRequired ? "move on" : "finish this puzzle"} now, or keep playing it for as long as you like.`;
    $("nextBtn").textContent = last ? "Finish" : moreRequired ? "Next puzzle" : "Finish this puzzle";
    $("timeup").hidden = false;
  }
}

function endRound() {
  const a = session.active;
  if (!a || !a.minimumReached) return;
  clearInterval(clockTimer);
  if (a.attemptOpen) abandonAttempt("moved on");
  game.token = null;                                // stops any pending computer move
  const result = {
    round: a.index + 1, opening: a.opening, side: COLOUR[sideOf(a.opening)],
    attempts: a.attempts, best: a.best,
    timeMs: Math.round(a.elapsedMs), extraTimeMs: Math.round(a.elapsedMs - REQUIRED_MS),
  };
  session.results.push(result);
  session.active = null;
  session.round++;
  record("round_end", result);
  game = null;
  selected = null;
  sendContact();
  if (session.round >= session.order.length) {
    finishSession(false);
  } else if (session.round >= (session.requiredPuzzles || REQUIRED_ROUNDS)) {
    showThanks(`round${result.round}`);
  } else {
    uploadLog(`round${result.round}`);
    showMenu();
  }
}

function finishSession(early) {
  session.finished = true;
  record("session_finished", { puzzles: session.round, early });
  showDone();
}

// Thank-you screen once the required puzzles are done: the results are sent, and the
// participant can stop or carry on with more puzzles, up to all nine.
function showThanks(uploadLabel = null) {
  const played = session.round, total = session.order.length, left = total - played;
  show("thanks");
  record("thanks_shown", { puzzles: played });
  $("thanksLead").textContent = (played === 1 ? "You have finished the puzzle." : `You have finished ${played} puzzles.`)
    + " That is everything the study needs from you, so you can stop here.";
  progressBoxes($("thanksProgress"), false);
  $("thanksMore").textContent = "If you enjoyed it and would like to help more, you can play as many more puzzles as you like, "
    + `up to ${total} in total (${left} left). Each one takes ${ROUND_MINUTES} minutes and you can stop after any of them.`
    + (session.consent && session.consent.prizeEntered ? " Every puzzle has its own prize, so each one you play is another chance to win." : "");
  $("moreBtn").textContent = "Play another puzzle";
  $("thanksCode").innerHTML = `Your participant code is <span class="code">${session.participant}</span>. ` +
    "Keep it if you might want your data removed later.";
  if (!uploadLabel && (session.sentThrough || 0) >= played) {
    $("thanksStatus").textContent = "Your results have been sent.";
    $("thanksFallback").hidden = true;
  } else {
    sendWithStatus(uploadLabel || `round${played}`, $("thanksStatus"), $("thanksFallback"));
  }
}

// Finish screen: sends the final log, trying three times; if that fails, or DataPipe is
// not set up yet, the participant is asked to download the file and email it.
async function showDone() {
  show("done");
  const played = session.round, total = session.order.length;
  $("doneLead").textContent = (played >= total ? `You have finished all ${total} puzzles.`
    : played === 1 ? "You played 1 puzzle." : `You played ${played} puzzles.`) + " Thank you for taking part.";
  $("doneCode").innerHTML = `Your participant code is <span class="code">${session.participant}</span>. ` +
    "Keep it if you might want your data removed later.";
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

function endPractice() {
  if (game.attemptOpen) abandonAttempt("left practice");
  game.token = null;
  session.practiceDone = true;
  record("practice_end", { attempts: game.attempt });
  game = null;
  selected = null;
  showMenu();
}

// ---------------------------------------------------------------- one game
function newAttempt() {
  game.attempt++;
  game.token = Symbol();
  game.state = game.kind === "practice" ? new GameState(SMALL, 2) : openingState(SMALL, game.opening);
  game.startMoves = game.state.history.length;
  game.over = false;
  game.busy = false;
  game.lastComputer = null;
  game.attemptOpen = true;
  game.prevScore = game.lastScore ?? null;
  // Rough per-game score (rounds only, needs a version 2 opponent file with values).
  // value: best final margin still reachable, from the participant's side.
  const start = game.kind === "round" && game.table.startValue != null
    ? (game.human === 0 ? game.table.startValue : -game.table.startValue) : TARGET_MARGIN;
  game.score = game.kind === "round" && game.table.values ? { value: start, pending: [], costs: [] } : null;
  selected = null;
  if (game.kind === "round") { session.active.attempts = game.attempt; session.active.attemptOpen = true; }
  record("attempt_start", {
    kind: game.kind, round: game.round, opening: game.opening, side: COLOUR[game.human], attempt: game.attempt,
  });
  render();
  if (game.state.current !== game.human) computerTurn();
}

function abandonAttempt(reason) {
  record("attempt_abandoned", {
    kind: game ? game.kind : "round", reason,
    moves: game && game.state ? game.state.history.slice(game.startMoves).map(h => h[1]) : null,
  });
  if (game) game.attemptOpen = false;
  if (session.active) session.active.attemptOpen = false;
}

const myTurn = () => game && !game.over && !game.busy && game.state.current === game.human;

// A participant move's cost is how much it lowers the best final margin still reachable
// (both sides perfect from then on), so later consequences are included. Moves made in a
// row because the computer is out are scored together once the next value is known.
function settleMoves(value) {
  const sc = game.score;
  if (!sc) return;
  const cost = Math.max(0, sc.value - value);
  for (const _ of sc.pending) sc.costs.push(cost);
  sc.pending = [];
  sc.value = value;
}

// Score out of 100: each move scores 100 if perfect, otherwise 100 / (1 + points lost); averaged over the game.
function gameScore() {
  const costs = game.score ? game.score.costs : [];
  if (!costs.length) return null;
  return Math.round(100 * costs.reduce((t, c) => t + 1 / (1 + c), 0) / costs.length);
}

function computerMove(state) {
  if (game.kind === "practice") {                    // practice opponent: a random legal move
    const legal = state.legalActions();
    return legal[Math.floor(Math.random() * legal.length)];
  }
  const entry = game.table.lookup(positionKey(state));
  if (!entry) return null;
  if (entry.value !== null) settleMoves(game.human === 0 ? entry.value : -entry.value);
  return entry.reply;
}

function computerTurn() {
  game.busy = true;
  render();
  const token = game.token;
  const step = () => {
    if (!game || game.token !== token) return;          // the attempt or round has ended
    const state = game.state;
    const reply = computerMove(state);
    if (reply === null || !state.isLegal(reply)) {
      record("error", { problem: "no stored reply", opening: game.opening, moves: state.history.map(h => h[1]) });
      setStatus("Something went wrong: the computer has no stored move here.");
      return;
    }
    const player = state.current;
    state.play(reply);
    game.lastComputer = reply;
    record("move", { by: "computer", player, action: reply });
    if (state.gameOver) return finishAttempt();
    if (state.current !== game.human) {               // participant is out: computer moves again
      render();
      setTimeout(step, COMPUTER_DELAY_MS);
      return;
    }
    game.busy = false;
    render();
  };
  setTimeout(step, COMPUTER_DELAY_MS);
}

function finishAttempt() {
  const s = game.state.scores();
  const margin = s[game.human] - s[1 - game.human];
  game.over = true;
  game.busy = false;
  game.attemptOpen = false;
  if (game.best === null || margin > game.best) game.best = margin;
  settleMoves(margin);
  const score = gameScore();
  if (score !== null) {
    game.lastScore = score;
    if (game.bestScore === null || score > game.bestScore) game.bestScore = score;
  }
  if (game.kind === "round") {
    session.active.best = game.best;
    session.active.lastScore = game.lastScore;
    session.active.bestScore = game.bestScore;
    session.active.attemptOpen = false;
  }
  record("attempt_end", {
    kind: game.kind, round: game.round, opening: game.opening, attempt: game.attempt, scores: s, margin,
    moves: game.state.history.slice(game.startMoves).map(h => h[1]),
    score, moveCosts: game.score ? game.score.costs : null,
  });
  render();
}

// ---------------------------------------------------------------- choosing and placing
function orientationIndex(piece, shape) {
  const id = shapeId(shape);
  return ORIENTATIONS[piece].findIndex(o => shapeId(o) === id);
}

// The cell of the shape that sits under the mouse: the one nearest the shape's centre.
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
  if (inputKind !== "mouse") hover = null;           // on a touch screen the shadow appears where the board is next tapped
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
  const state = game.state;
  record("move", { by: "participant", player: state.current, action: p.action, piece: selected.piece, orientation, input: inputKind });
  state.play(p.action);
  if (game.score) game.score.pending.push(p.action);
  selected = null;
  if (inputKind !== "mouse") hover = null;
  if (state.gameOver) return finishAttempt();
  if (state.current !== game.human) return computerTurn();
  render();                                            // computer is out: participant moves again
}

let messageTimer = null;
function showMessage(text) {
  $("message").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("message").textContent = ""), 1800);
}

// ---------------------------------------------------------------- drawing the game
function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = cls;
}

function describeMargin(m) {
  if (m > 0) return `won by ${m}`;
  if (m < 0) return `lost by ${-m}`;
  return "drew";
}

// Squares where the participant could start a piece: corner-touching, and used by at least one legal move.
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
      d.dataset.r = r;
      d.dataset.c = c;
      $("board").appendChild(d);
      boardCells.push(d);
    }
  }
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
  const last = new Set(game.lastComputer === null ? [] : SMALL.actions[game.lastComputer].cells.map(([r, c]) => r * 8 + c));
  boardCells.forEach((d, i) => {
    const owner = grid[Math.floor(i / 8)][i % 8];
    let cls = "cell";
    if (owner !== null) cls += ` p${owner}`;
    if (ghost.has(i)) cls += ghost.get(i) ? " gl" : " gi";
    else if (owner === null && anchors.has(i)) cls += " anchor";
    if (last.has(i)) cls += " last";
    if (d.className !== cls) d.className = cls;
  });

  const tray = $("tray");
  tray.replaceChildren();
  for (const piece of SMALL.pieces) {
    const used = !state.remaining[me].has(piece);
    const b = document.createElement("button");
    b.className = "piece" + (selected && selected.piece === piece ? " selected" : "");
    b.disabled = used || game.over;
    b.setAttribute("aria-label", `Piece ${PIECES[piece][0]}`);
    b.appendChild(miniShape(selected && selected.piece === piece ? selected.shape : ORIENTATIONS[piece][0], me, used));
    b.addEventListener("click", () => selectPiece(piece));
    tray.appendChild(b);
  }
  $("their").replaceChildren(...SMALL.pieces.map(piece =>
    miniShape(ORIENTATIONS[piece][0], 1 - me, !state.remaining[1 - me].has(piece))));

  $("roundInfo").textContent = game.kind === "practice"
    ? `Practice game: you are ${COLOUR[me]}. The computer here plays randomly.`
    : game.round <= (session.requiredPuzzles || REQUIRED_ROUNDS) && (session.requiredPuzzles || REQUIRED_ROUNDS) === 1
      ? `Puzzle: you are ${COLOUR[me]}`
      : `Puzzle ${game.round} of ${session.order.length}: you are ${COLOUR[me]}`;
  $("attemptInfo").textContent = `Attempt ${game.attempt}`;
  $("bestInfo").textContent = game.best === null ? "" : `Best result: ${describeMargin(game.best)}`
    + (game.bestScore == null ? "" : `, best score ${game.bestScore}`);
  if (game.over) setStatus("Game over");
  else if (game.busy) setStatus(state.out[me] ? "You have no moves left. The computer plays on." : "Computer is moving", "them");
  else setStatus("Your move", "me");

  $("result").hidden = !game.over;
  const showScore = game.over && game.lastScore != null && game.kind === "round";
  $("resultScore").hidden = !showScore;
  if (showScore) {
    const prev = game.prevScore;
    $("scoreValue").textContent = game.lastScore;
    $("scoreChange").textContent = prev == null ? ""
      : game.lastScore > prev ? `up from ${prev}` : game.lastScore < prev ? `down from ${prev}` : `same as last game`;
    $("scoreChange").className = prev == null || game.lastScore === prev ? "" : game.lastScore > prev ? "up" : "down";
  }
  $("practiceDoneBtn").hidden = game.kind !== "practice";
  if (game.over) {
    const s = state.scores();
    const margin = s[me] - s[1 - me];
    $("resultMain").textContent = `You ${describeMargin(margin)}.`;
    $("resultSub").textContent = game.kind === "practice"
      ? "Play again, or go back to the menu when you are ready to start the puzzles."
      : margin >= TARGET_MARGIN
        ? "That's the best possible result: every move you made was perfect."
        : `The best possible result here is a win by ${TARGET_MARGIN}.`;
  }
}

// ---------------------------------------------------------------- input
// Mouse: the shadow follows the pointer and a click places the piece.
// Touch or pen: tapping or dragging on the board moves the shadow (dragging moves it by the
// distance the finger travels, so it does not jump under the finger); tapping the shadow
// again, without dragging, places the piece.
let inputKind = "mouse";     // "mouse", "touch" or "pen": what was last used on the board
let press = null;            // touch in progress: {id, start cell, shadow position at start, moved, inShadow}

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
    if (!inShadow) setHover(cell);                       // shadow jumps to the tapped square
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
    if (p.inShadow && !p.moved && selected && hover) clickCell(hover[0], hover[1]);   // tapped the shadow: place it
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
    if (now - lastWheel < 150) return;               // trackpads send many small scroll events
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
  $("againBtn").addEventListener("click", () => newAttempt());
  $("practiceDoneBtn").addEventListener("click", endPractice);
  $("nextBtn").addEventListener("click", endRound);
  $("moreBtn").addEventListener("click", () => { record("play_more", { puzzles: session.round }); startRound($("moreBtn"), $("thanksMore")); });
  $("finishBtn").addEventListener("click", () => finishSession(true));
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

  document.addEventListener("visibilitychange", () => record("visibility", { state: document.visibilityState }));
  window.addEventListener("blur", () => record("window_blur"));
  window.addEventListener("focus", () => record("window_focus"));
  window.addEventListener("pagehide", () => { tick(); save(); });
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
  record("page_load", { resumed: !!saved });
  if (!storageOk) $("storageNote").hidden = false;
  if (saved && session.active) {
    record("round_interrupted", { round: session.active.index + 1, opening: session.active.opening, elapsedMs: Math.round(session.active.elapsedMs) });
    if (session.active.attemptOpen) abandonAttempt("page closed");
  }
  if (session.finished) showDone();
  else if (!session.consent) show("consent");
  else showMenu();
  if (session.consent) sendContact();          // retry an unsent prize email

  if (DEV) {
    $("devbar").hidden = false;
    $("devReset").addEventListener("click", () => {
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(CONTACT_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });
    $("devDownload").addEventListener("click", download);
    $("devSkip").addEventListener("click", () => {
      if (session.active) { session.active.elapsedMs = Math.max(session.active.elapsedMs, REQUIRED_MS - 2000); updateClock(); }
    });
  }
  // read-only view for automated tests
  window.blokusTest = { get game() { return game; }, get selected() { return selected; }, get session() { return session; }, anchorOf, orientationIndex };
}

main();
