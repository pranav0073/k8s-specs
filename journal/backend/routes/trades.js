const express = require('express');
const router = express.Router();
const db = require('../db');

const LOT_SIZE = 65; // NIFTY lot size

function parseLeg(leg) {
  return {
    ...leg,
    strike:      Number(leg.strike),
    lots:        Number(leg.lots),
    entry_price: Number(leg.entry_price),
    exit_price:  leg.exit_price != null ? Number(leg.exit_price) : null,
  };
}

function calcPnl(legs, status) {
  if (status !== 'closed') return null;
  const pnl = legs.reduce((sum, leg) => {
    if (leg.exit_price == null) return sum;
    const mult = leg.side === 'B' ? 1 : -1;
    return sum + (leg.exit_price - leg.entry_price) * LOT_SIZE * leg.lots * mult;
  }, 0);
  return Math.round(pnl * 100) / 100;
}

function calcNetPremium(legs) {
  const net = legs.reduce((sum, leg) => {
    const mult = leg.side === 'B' ? 1 : -1;
    return sum + leg.entry_price * LOT_SIZE * leg.lots * mult;
  }, 0);
  return Math.round(net * 100) / 100;
}

function parseTrade(row) {
  const legs = JSON.parse(row.legs || '[]').map(parseLeg);
  const tags = JSON.parse(row.tags || '[]');
  return { ...row, legs, tags, pnl: calcPnl(legs, row.status), netPremium: calcNetPremium(legs) };
}

// GET /api/trades
router.get('/', (req, res) => {
  const { instrument, strategy, status, from, to } = req.query;
  let query = 'SELECT * FROM trades WHERE 1=1';
  const params = [];

  if (instrument) { query += ' AND instrument = ?'; params.push(instrument.toUpperCase()); }
  if (strategy)   { query += ' AND strategy = ?';   params.push(strategy); }
  if (status)     { query += ' AND status = ?';     params.push(status); }
  if (from)       { query += ' AND date >= ?';      params.push(from); }
  if (to)         { query += ' AND date <= ?';      params.push(to); }

  query += ' ORDER BY date DESC, id DESC';
  res.json(db.prepare(query).all(...params).map(parseTrade));
});

// GET /api/trades/stats
router.get('/stats', (req, res) => {
  const trades = db.prepare("SELECT * FROM trades WHERE status = 'closed'").all().map(parseTrade);

  const total    = trades.length;
  const winners  = trades.filter(t => t.pnl > 0);
  const losers   = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const winRate  = total > 0 ? (winners.length / total) * 100 : 0;
  const avgWin   = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss  = losers.length  > 0 ? losers.reduce((s, t)  => s + t.pnl, 0) / losers.length  : 0;
  const bestTrade  = trades.reduce((b, t) => (t.pnl > (b?.pnl ?? -Infinity) ? t : b), null);
  const worstTrade = trades.reduce((w, t) => (t.pnl < (w?.pnl ??  Infinity) ? t : w), null);

  let cum = 0;
  const equityCurve = [...trades]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(t => { cum += t.pnl || 0; return { date: t.date, pnl: Math.round(cum * 100) / 100 }; });

  const byMonth = {};
  trades.forEach(t => {
    const m = t.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + (t.pnl || 0);
  });
  const pnlByMonth = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }));

  const byStrategy = {};
  trades.forEach(t => {
    const key = t.strategy || 'Other';
    byStrategy[key] = (byStrategy[key] || 0) + (t.pnl || 0);
  });
  const pnlByStrategy = Object.entries(byStrategy)
    .map(([strategy, pnl]) => ({ strategy, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  res.json({
    total,
    totalPnl:    Math.round(totalPnl * 100) / 100,
    winRate:     Math.round(winRate * 10) / 10,
    winners:     winners.length,
    losers:      losers.length,
    avgWin:      Math.round(avgWin * 100) / 100,
    avgLoss:     Math.round(avgLoss * 100) / 100,
    bestTrade,
    worstTrade,
    equityCurve,
    pnlByMonth,
    pnlByStrategy,
  });
});

// GET /api/trades/:id
router.get('/:id', (req, res) => {
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  res.json(parseTrade(trade));
});

// POST /api/trades
router.post('/', (req, res) => {
  const { date, instrument, strategy, legs, status, notes, tags, close_date } = req.body;
  if (!date || !Array.isArray(legs) || legs.length === 0) {
    return res.status(400).json({ error: 'date and legs[] are required' });
  }
  const result = db.prepare(`
    INSERT INTO trades (date, instrument, strategy, legs, status, notes, tags, close_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date,
    (instrument || 'NIFTY').toUpperCase(),
    strategy || null,
    JSON.stringify(legs),
    status || 'open',
    notes || null,
    JSON.stringify(tags || []),
    close_date || null
  );
  res.status(201).json(parseTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(result.lastInsertRowid))));
});

// PUT /api/trades/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Trade not found' });

  const { date, instrument, strategy, legs, status, notes, tags, close_date } = req.body;
  db.prepare(`
    UPDATE trades SET date=?, instrument=?, strategy=?, legs=?, status=?, notes=?, tags=?, close_date=? WHERE id=?
  `).run(
    date       ?? existing.date,
    ((instrument ?? existing.instrument) || 'NIFTY').toUpperCase(),
    strategy !== undefined ? (strategy || null) : existing.strategy,
    legs ? JSON.stringify(legs) : existing.legs,
    status ?? existing.status,
    notes !== undefined ? (notes || null) : existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    close_date !== undefined ? (close_date || null) : existing.close_date,
    req.params.id
  );
  res.json(parseTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id)));
});

// DELETE /api/trades/:id
router.delete('/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM trades WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Trade not found' });
  db.prepare('DELETE FROM trades WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM trade_comments WHERE trade_id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Trade Comments ────────────────────────────────────────────────────────────

// GET /api/trades/:id/comments
router.get('/:id/comments', (req, res) => {
  const comments = db.prepare(
    'SELECT * FROM trade_comments WHERE trade_id = ? ORDER BY date ASC'
  ).all(req.params.id);
  res.json(comments);
});

// POST /api/trades/:id/comments  (upsert by trade_id + date)
router.post('/:id/comments', (req, res) => {
  const { date, comment, emotion } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const existing = db.prepare(
    'SELECT id FROM trade_comments WHERE trade_id = ? AND date = ?'
  ).get(req.params.id, date);

  if (existing) {
    db.prepare('UPDATE trade_comments SET comment=?, emotion=? WHERE id=?')
      .run(comment || null, emotion || null, existing.id);
  } else {
    db.prepare('INSERT INTO trade_comments (trade_id, date, comment, emotion) VALUES (?, ?, ?, ?)')
      .run(req.params.id, date, comment || null, emotion || null);
  }
  res.json(
    db.prepare('SELECT * FROM trade_comments WHERE trade_id = ? AND date = ?').get(req.params.id, date)
  );
});

// DELETE /api/trades/:id/comments/:cid
router.delete('/:id/comments/:cid', (req, res) => {
  db.prepare('DELETE FROM trade_comments WHERE id = ? AND trade_id = ?')
    .run(req.params.cid, req.params.id);
  res.json({ success: true });
});

module.exports = router;
