// Leaderboard for the Blokus study. Paste this into the Apps Script editor of a Google Sheet
// (Extensions > Apps Script) and deploy it as a web app: see SETUP.md.
//
// One row per finished puzzle: time, participant code, leaderboard name, opening, points, test.
// POST adds a row (once per participant and puzzle) and returns the participant's rank on that
// puzzle with the places around them; with overall: true it also returns the overall ranking
// (total over all nine puzzles, among people who have finished all nine).
// GET ?action=overall&participant=CODE&test=0 returns the overall ranking on its own.
// Rows from testing sessions (test = true) are kept apart from real ones.
//
// This address is public (it is in experiment.js), so anyone can send to it. It cannot tell a real
// score from a made-up one; it only refuses scores and names the page could never send. Fake rows
// can be deleted from the sheet; the study's own data (sent through DataPipe) is checked separately.

const SHEET_NAME = "scores";
const OPENINGS = [311, 39, 230, 419, 243, 2, 41, 15, 6];
const MAX_POINTS = 20;
const NEIGHBOURS = 2;

// Names are shown to every player, and anyone can send to this address, so only the two kinds of
// name the study page makes are accepted: a three-letter tag that is not on the blocked list, or a
// random "Word Animal" name from these lists (keep both in step with experiment.js). Anything else
// (offensive names, links, spreadsheet formulas starting with "=") is refused.
const NAME_WORDS = [
  ["Amber", "Arctic", "Bold", "Brave", "Bright", "Calm", "Clever", "Cosmic", "Crimson", "Daring", "Dusty", "Electric",
   "Fearless", "Gentle", "Golden", "Happy", "Jolly", "Lucky", "Mighty", "Misty", "Nimble", "Noble", "Polar", "Quick",
   "Quiet", "Rapid", "Royal", "Rusty", "Silver", "Sly", "Sunny", "Swift", "Teal", "Witty"],
  ["Badger", "Bear", "Beaver", "Bison", "Cheetah", "Crane", "Dolphin", "Eagle", "Falcon", "Ferret", "Fox", "Gecko",
   "Hare", "Hawk", "Heron", "Ibex", "Koala", "Lemur", "Lynx", "Moose", "Narwhal", "Otter", "Owl", "Panda", "Panther",
   "Puffin", "Raven", "Robin", "Seal", "Stag", "Tiger", "Walrus", "Wolf", "Yak"],
];
const BLOCKED_TAGS = ("FUK FUC FCK FKU FKN FUX FAK PHK CNT KNT CUN KUN CUM JIZ JZZ SEX SXY SXX XXX PRN " +
  "ASS AZZ ARS TIT TTS DIK DIC DCK DIX COK COC CCK KOK PUS PSS PIS PNS VAG VAJ CLT TWT WNK NOB KNB BJS HJS ANL FAP " +
  "SLT SLU HOE HOR WHR FAG FGT GAY NIG NGR NGA NGG KKK NAZ NZI HTL JEW KIK KYK SPC SPK SPI WOG GOK GUK PKI CHK " +
  "RTD TRD SPZ KYS KMS RPE STD WTF STF GTF BCH SHT SUK").split(" ");

function nameOk_(name) {
  if (typeof name !== "string") return false;
  if (/^[A-Z]{3}$/.test(name)) return BLOCKED_TAGS.indexOf(name) < 0;
  const w = name.split(" ");
  return w.length === 2 && NAME_WORDS[0].indexOf(w[0]) >= 0 && NAME_WORDS[1].indexOf(w[1]) >= 0;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["time", "participant", "name", "opening", "points", "test"]);
  }
  return sh;
}

function rows_(test) {
  const values = sheet_().getDataRange().getValues();
  values.shift();   // header
  return values
    .filter(r => (r[5] === true || r[5] === "TRUE") === test)
    .map(r => ({ participant: String(r[1]), name: String(r[2]), opening: Number(r[3]), points: Number(r[4]) }));
}

// Highest points first; equal points share a rank (1, 2, 2, 4).
function board_(list, participant) {
  list.sort((a, b) => b.points - a.points);
  let rank = 0, prev = null;
  list.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = rank; });
  const me = list.findIndex(r => r.participant === participant);
  if (me < 0) return { total: list.length, rank: null, rows: [] };
  const lo = Math.max(0, me - NEIGHBOURS), hi = Math.min(list.length, me + NEIGHBOURS + 1);
  return {
    total: list.length,
    rank: list[me].rank,
    rows: list.slice(lo, hi).map(r => ({ rank: r.rank, name: r.name, points: r.points, me: r.participant === participant })),
  };
}

function overall_(participant, test) {
  const byPerson = {};
  rows_(test).forEach(r => {
    const p = byPerson[r.participant] || (byPerson[r.participant] = { participant: r.participant, name: r.name, points: 0, puzzles: 0 });
    p.points += r.points;
    p.puzzles += 1;
  });
  const finished = Object.keys(byPerson).map(k => byPerson[k]).filter(p => p.puzzles === OPENINGS.length);
  return board_(finished, participant);
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = e.parameter || {};
  const test = p.test === "1";
  if (p.action === "overall") return respond_(overall_(String(p.participant || ""), test));
  return respond_({ error: "unknown action" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const test = d.test === true;
    const opening = Number(d.opening), points = Number(d.points);
    const valid = /^[A-Z0-9]{6}$/.test(String(d.participant))
      && OPENINGS.indexOf(opening) >= 0
      && points >= 0 && points <= MAX_POINTS
      && Math.round(points * 4) === points * 4              // scores move in steps of 0.25
      && nameOk_(d.name);
    if (!valid) return respond_({ error: "bad request" });
    const already = rows_(test).some(r => r.participant === d.participant && r.opening === opening);
    if (!already) sheet_().appendRow([new Date(), d.participant, d.name, opening, points, test]);
    const result = board_(rows_(test).filter(r => r.opening === opening), d.participant);
    if (d.overall) result.overall = overall_(d.participant, test);
    return respond_(result);
  } catch (err) {
    return respond_({ error: "server error" });              // no internal details to strangers
  } finally {
    lock.releaseLock();
  }
}
