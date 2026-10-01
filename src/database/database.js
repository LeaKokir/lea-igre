const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../../data/lea-igre.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 100,
  wordle_wins INTEGER NOT NULL DEFAULT 0,
  wordle_played INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_wordle_date TEXT
);

CREATE TABLE IF NOT EXISTS wordle_games (
  date TEXT PRIMARY KEY,
  word TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wordle_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  guess TEXT NOT NULL,
  UNIQUE(user_id, date, guess)
);
`);

function getPlayer(user) {
  let p = db.prepare("SELECT * FROM players WHERE user_id = ?").get(user.id);
  if (!p) {
    db.prepare("INSERT INTO players (user_id, username) VALUES (?, ?)")
      .run(user.id, user.username);
    p = db.prepare("SELECT * FROM players WHERE user_id = ?").get(user.id);
  } else if (p.username !== user.username) {
    db.prepare("UPDATE players SET username = ? WHERE user_id = ?")
      .run(user.username, user.id);
    p.username = user.username;
  }
  return p;
}

function addXP(userId, amount) {
  db.prepare("UPDATE players SET xp = xp + ? WHERE user_id = ?").run(amount, userId);
}

function addCoins(userId, amount) {
  db.prepare("UPDATE players SET coins = coins + ? WHERE user_id = ?").run(amount, userId);
}

function getToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade"
  }).format(new Date());
}

function getDailyWord(date, words) {
  const existing = db.prepare("SELECT word FROM wordle_games WHERE date = ?").get(date);
  if (existing) return existing.word;

  // Deterministički izbor reči za taj dan.
  const epochDay = Math.floor(Date.now() / 86400000);
  const word = words[epochDay % words.length];

  db.prepare("INSERT INTO wordle_games (date, word) VALUES (?, ?)").run(date, word);
  return word;
}

function getAttempts(userId, date) {
  return db.prepare(
    "SELECT guess FROM wordle_attempts WHERE user_id = ? AND date = ? ORDER BY id"
  ).all(userId, date).map(x => x.guess);
}

function addAttempt(userId, date, guess) {
  return db.prepare(
    "INSERT OR IGNORE INTO wordle_attempts (user_id, date, guess) VALUES (?, ?, ?)"
  ).run(userId, date, guess);
}

function finishWordle(userId, date, won) {
  const p = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  if (p.last_wordle_date === date) return p;

  let streak = 1;
  if (p.last_wordle_date) {
    const last = new Date(`${p.last_wordle_date}T00:00:00`);
    const current = new Date(`${date}T00:00:00`);
    const days = Math.round((current - last) / 86400000);
    if (days === 1) streak = p.current_streak + 1;
  }

  if (!won) streak = 0;

  db.prepare(`
    UPDATE players
    SET wordle_played = wordle_played + 1,
        wordle_wins = wordle_wins + ?,
        current_streak = ?,
        best_streak = MAX(best_streak, ?),
        last_wordle_date = ?
    WHERE user_id = ?
  `).run(won ? 1 : 0, streak, streak, date, userId);

  return db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
}

function leaderboard() {
  return db.prepare(`
    SELECT * FROM players
    ORDER BY xp DESC, wordle_wins DESC
    LIMIT 10
  `).all();
}

module.exports = {
  getPlayer, addXP, addCoins, getToday, getDailyWord,
  getAttempts, addAttempt, finishWordle, leaderboard
};
