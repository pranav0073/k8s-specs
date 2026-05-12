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

// Migration: add close_date column if absent
const tradeCols = db.prepare('PRAGMA table_info(trades)').all();
if (!tradeCols.find(c => c.name === 'close_date')) {
  db.exec('ALTER TABLE trades ADD COLUMN close_date TEXT');
}

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

// Migration: add images column to trade_comments
const commentCols = db.prepare('PRAGMA table_info(trade_comments)').all();
if (!commentCols.find(c => c.name === 'images')) {
  db.exec("ALTER TABLE trade_comments ADD COLUMN images TEXT DEFAULT '[]'");
}

module.exports = db;
