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

module.exports = db;
