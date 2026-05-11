const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'journal.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT    NOT NULL,
    date         TEXT    NOT NULL,
    direction    TEXT    NOT NULL CHECK(direction IN ('long', 'short')),
    entry_price  REAL    NOT NULL,
    exit_price   REAL,
    quantity     REAL    NOT NULL,
    strategy     TEXT,
    tags         TEXT    DEFAULT '[]',
    notes        TEXT,
    status       TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    created_at   TEXT    DEFAULT (datetime('now'))
  )
`);

module.exports = db;
