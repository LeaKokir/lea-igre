const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

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

CREATE TABLE IF NOT EXISTS wordle_free_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  channel_id TEXT,
  word TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wordle_free_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  guess TEXT NOT NULL
);
`);

// Migracije za raniju verziju dodatnog Wordle-a.
// Ranije je dodatna partija bila vezana za user_id. Sada je vezujemo za channel_id
// tako da svi igrači u istom kanalu dobijaju ISTU reč, ali svako ima svojih 6 pokušaja.
const freeColumns = db.prepare("PRAGMA table_info(wordle_free_games)").all();
const hasChannelId = freeColumns.some(c => c.name === "channel_id");
if (!hasChannelId) {
  db.exec(`
    CREATE TABLE wordle_free_games_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      channel_id TEXT,
      word TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO wordle_free_games_new (id, user_id, channel_id, word, attempts, status, created_at)
      SELECT id, user_id, NULL, word, attempts, status, created_at FROM wordle_free_games;
    DROP TABLE wordle_free_games;
    ALTER TABLE wordle_free_games_new RENAME TO wordle_free_games;
  `);
}
// Stare aktivne partije su bile privatne po korisniku; završavamo ih da ne smetaju novom zajedničkom režimu.
db.prepare("UPDATE wordle_free_games SET status = 'legacy' WHERE channel_id IS NULL AND status = 'active'").run();

// Ranija tabela je imala UNIQUE(game_id, guess), što je sprečavalo više igrača
// da koriste istu probnu reč u istoj zajedničkoj partiji.
const attemptIndexes = db.prepare("PRAGMA index_list(wordle_free_attempts)").all();
const hasOldUnique = attemptIndexes.some(i => i.unique);
if (hasOldUnique) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wordle_free_attempts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      guess TEXT NOT NULL,
      UNIQUE(game_id, user_id, guess)
    );
    INSERT OR IGNORE INTO wordle_free_attempts_new (id, game_id, user_id, guess)
      SELECT id, game_id, user_id, guess FROM wordle_free_attempts;
    DROP TABLE wordle_free_attempts;
    ALTER TABLE wordle_free_attempts_new RENAME TO wordle_free_attempts;
  `);
}

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

function getLatestFreeGame(channelId) {
  return db.prepare(`
    SELECT * FROM wordle_free_games
    WHERE channel_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(channelId);
}

function getActiveFreeGame(channelId) {
  return db.prepare(`
    SELECT * FROM wordle_free_games
    WHERE channel_id = ? AND status = 'active'
    ORDER BY id DESC LIMIT 1
  `).get(channelId);
}

function createFreeGame(channelId, words, excludeWord = null) {
  let candidates = excludeWord ? words.filter(w => w !== excludeWord) : words;
  if (!candidates.length) candidates = words;
  const word = candidates[crypto.randomInt(0, candidates.length)];

  const result = db.prepare(`
    INSERT INTO wordle_free_games (channel_id, word, attempts, status)
    VALUES (?, ?, 0, 'active')
  `).run(channelId, word);

  return db.prepare("SELECT * FROM wordle_free_games WHERE id = ?").get(result.lastInsertRowid);
}

function getFreeAttempts(gameId, userId) {
  return db.prepare(`
    SELECT guess FROM wordle_free_attempts
    WHERE game_id = ? AND user_id = ? ORDER BY id
  `).all(gameId, userId).map(x => x.guess);
}

function addFreeAttempt(gameId, userId, guess) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO wordle_free_attempts (game_id, user_id, guess)
    VALUES (?, ?, ?)
  `).run(gameId, userId, guess);

  if (result.changes) {
    db.prepare("UPDATE wordle_free_games SET attempts = attempts + 1 WHERE id = ?")
      .run(gameId);
  }

  return result;
}

function finishFreeGame(gameId, won) {
  db.prepare(`
    UPDATE wordle_free_games
    SET status = ?
    WHERE id = ? AND status = 'active'
  `).run(won ? "won" : "lost", gameId);
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
  getAttempts, addAttempt, finishWordle,
  getLatestFreeGame, getActiveFreeGame, createFreeGame, getFreeAttempts, addFreeAttempt, finishFreeGame,
  leaderboard
};
