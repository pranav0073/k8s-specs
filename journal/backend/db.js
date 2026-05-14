const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'journal.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    instrument  TEXT NOT NULL DEFAULT 'NIFTY',
    strategy    TEXT,
    legs        TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    notes       TEXT,
    tags        TEXT DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now'))
  )
`);

// Migration: add columns to trades if absent
const tradeCols = db.prepare('PRAGMA table_info(trades)').all();
if (!tradeCols.find(c => c.name === 'close_date'))   db.exec('ALTER TABLE trades ADD COLUMN close_date TEXT');
if (!tradeCols.find(c => c.name === 'exit_plan'))     db.exec('ALTER TABLE trades ADD COLUMN exit_plan TEXT');
if (!tradeCols.find(c => c.name === 'exit_plan_at'))  db.exec('ALTER TABLE trades ADD COLUMN exit_plan_at TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS market_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL UNIQUE,
    instrument TEXT NOT NULL DEFAULT 'NIFTY',
    open       REAL,
    high       REAL,
    low        REAL,
    close      REAL,
    prev_close REAL,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id   INTEGER NOT NULL,
    date       TEXT NOT NULL,
    comment    TEXT,
    emotion    TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(trade_id, date)
  )
`);

// Migration: add images column to market_sessions
const sessionCols = db.prepare('PRAGMA table_info(market_sessions)').all();
if (!sessionCols.find(c => c.name === 'images')) {
  db.exec("ALTER TABLE market_sessions ADD COLUMN images TEXT DEFAULT '[]'");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS market_analysis (
    id           INTEGER PRIMARY KEY,
    analysis     TEXT,
    generated_at TEXT
  )
`);
// Seed the singleton row so GET always finds a row
const hasRow = db.prepare('SELECT id FROM market_analysis WHERE id = 1').get();
if (!hasRow) db.prepare('INSERT INTO market_analysis (id) VALUES (1)').run();

// Migration: add images column to trade_comments
const commentCols = db.prepare('PRAGMA table_info(trade_comments)').all();
if (!commentCols.find(c => c.name === 'images')) {
  db.exec("ALTER TABLE trade_comments ADD COLUMN images TEXT DEFAULT '[]'");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_charges (
    date             TEXT PRIMARY KEY,
    brokerage        REAL NOT NULL DEFAULT 0,
    stt              REAL NOT NULL DEFAULT 0,
    exchange_charges REAL NOT NULL DEFAULT 0,
    gst              REAL NOT NULL DEFAULT 0,
    sebi_charges     REAL NOT NULL DEFAULT 0,
    stamp_duty       REAL NOT NULL DEFAULT 0,
    other            REAL NOT NULL DEFAULT 0,
    notes            TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
  )
`);

module.exports = db;
