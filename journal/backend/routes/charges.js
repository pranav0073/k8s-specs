const express = require('express');
const db      = require('../db');

const router = express.Router();

const FIELDS = ['brokerage', 'stt', 'exchange_charges', 'gst', 'sebi_charges', 'stamp_duty', 'other'];

function totalOf(row) {
  return FIELDS.reduce((s, f) => s + (row[f] || 0), 0);
}

function parseRow(row) {
  if (!row) return null;
  const total = totalOf(row);
  return { ...row, total: Math.round(total * 100) / 100 };
}

// GET /api/charges?from=&to=
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db.prepare('SELECT * FROM daily_charges WHERE date >= ? AND date <= ? ORDER BY date DESC').all(from, to);
  } else {
    rows = db.prepare('SELECT * FROM daily_charges ORDER BY date DESC').all();
  }
  res.json(rows.map(parseRow));
});

// GET /api/charges/:date
router.get('/:date', (req, res) => {
  const row = db.prepare('SELECT * FROM daily_charges WHERE date = ?').get(req.params.date);
  res.json(row ? parseRow(row) : null);
});

// POST /api/charges  — upsert (one entry per date)
router.post('/', (req, res) => {
  const { date, brokerage = 0, stt = 0, exchange_charges = 0, gst = 0,
          sebi_charges = 0, stamp_duty = 0, other = 0, notes = null } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  db.prepare(`
    INSERT INTO daily_charges (date, brokerage, stt, exchange_charges, gst, sebi_charges, stamp_duty, other, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      brokerage        = excluded.brokerage,
      stt              = excluded.stt,
      exchange_charges = excluded.exchange_charges,
      gst              = excluded.gst,
      sebi_charges     = excluded.sebi_charges,
      stamp_duty       = excluded.stamp_duty,
      other            = excluded.other,
      notes            = excluded.notes
  `).run(date, brokerage, stt, exchange_charges, gst, sebi_charges, stamp_duty, other, notes);
  res.json(parseRow(db.prepare('SELECT * FROM daily_charges WHERE date = ?').get(date)));
});

// DELETE /api/charges/:date
router.delete('/:date', (req, res) => {
  db.prepare('DELETE FROM daily_charges WHERE date = ?').run(req.params.date);
  res.json({ success: true });
});

module.exports = router;
