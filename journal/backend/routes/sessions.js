const express = require('express');
const router = express.Router();
const db = require('../db');

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// GET /api/sessions
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let query = 'SELECT * FROM market_sessions WHERE 1=1';
  const params = [];
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to)   { query += ' AND date <= ?'; params.push(to); }
  query += ' ORDER BY date DESC';
  res.json(db.prepare(query).all(...params));
});

// GET /api/sessions/:date
router.get('/:date', (req, res) => {
  const session = db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(req.params.date);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// GET /api/sessions/:date/active-trades
// Returns all trades whose entry date <= given date (and open trades, or closed with close_date >= date)
router.get('/:date/active-trades', (req, res) => {
  const { date } = req.params;
  const rows = db.prepare(`
    SELECT * FROM trades
    WHERE date <= ?
      AND (status = 'open' OR close_date IS NULL OR close_date >= ?)
    ORDER BY date DESC
  `).all(date, date);
  const parsed = rows.map(row => ({
    ...row,
    legs: JSON.parse(row.legs || '[]'),
    tags: JSON.parse(row.tags || '[]'),
  }));
  res.json(parsed);
});

// POST /api/sessions  (upsert by date)
router.post('/', (req, res) => {
  const { date, instrument, open, high, low, close, prev_close, notes } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const existing = db.prepare('SELECT id FROM market_sessions WHERE date = ?').get(date);
  if (existing) {
    db.prepare(`
      UPDATE market_sessions
      SET instrument=?, open=?, high=?, low=?, close=?, prev_close=?, notes=?
      WHERE date=?
    `).run(
      instrument || 'NIFTY',
      parseNum(open), parseNum(high), parseNum(low), parseNum(close), parseNum(prev_close),
      notes || null,
      date
    );
  } else {
    db.prepare(`
      INSERT INTO market_sessions (date, instrument, open, high, low, close, prev_close, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      date,
      instrument || 'NIFTY',
      parseNum(open), parseNum(high), parseNum(low), parseNum(close), parseNum(prev_close),
      notes || null
    );
  }
  res.json(db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(date));
});

// DELETE /api/sessions/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM market_sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
