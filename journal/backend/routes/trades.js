const express = require('express');
const router = express.Router();
const db = require('../db');

function calcPnl(trade) {
  if (trade.status === 'open' || !trade.exit_price) return null;
  const raw = trade.direction === 'long'
    ? (trade.exit_price - trade.entry_price) * trade.quantity
    : (trade.entry_price - trade.exit_price) * trade.quantity;
  return Math.round(raw * 100) / 100;
}

function parseTrade(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]'), pnl: calcPnl(row) };
}

// GET /api/trades
router.get('/', (req, res) => {
  const { symbol, direction, strategy, status, from, to, tag } = req.query;
  let query = 'SELECT * FROM trades WHERE 1=1';
  const params = [];

  if (symbol)    { query += ' AND symbol = ?';    params.push(symbol.toUpperCase()); }
  if (direction) { query += ' AND direction = ?'; params.push(direction); }
  if (strategy)  { query += ' AND strategy = ?';  params.push(strategy); }
  if (status)    { query += ' AND status = ?';    params.push(status); }
  if (from)      { query += ' AND date >= ?';     params.push(from); }
  if (to)        { query += ' AND date <= ?';     params.push(to); }

  query += ' ORDER BY date DESC, id DESC';

  let trades = db.prepare(query).all(...params).map(parseTrade);
  if (tag) trades = trades.filter(t => t.tags.includes(tag));

  res.json(trades);
});

// GET /api/trades/stats
router.get('/stats', (req, res) => {
  const trades = db.prepare("SELECT * FROM trades WHERE status = 'closed'").all().map(parseTrade);

  const total = trades.length;
  const winners = trades.filter(t => t.pnl > 0);
  const losers  = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const winRate  = total > 0 ? (winners.length / total) * 100 : 0;
  const avgWin   = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss  = losers.length  > 0 ? losers.reduce((s, t)  => s + t.pnl, 0) / losers.length  : 0;
  const bestTrade  = trades.reduce((b, t) => (t.pnl > (b?.pnl ?? -Infinity) ? t : b), null);
  const worstTrade = trades.reduce((w, t) => (t.pnl < (w?.pnl ??  Infinity) ? t : w), null);

  // Equity curve: cumulative P&L sorted by date
  let cum = 0;
  const equityCurve = [...trades]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(t => { cum += t.pnl || 0; return { date: t.date, pnl: Math.round(cum * 100) / 100 }; });

  // P&L by month (YYYY-MM)
  const byMonth = {};
  trades.forEach(t => {
    const m = t.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + (t.pnl || 0);
  });
  const pnlByMonth = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }));

  // P&L by symbol
  const bySymbol = {};
  trades.forEach(t => { bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + (t.pnl || 0); });
  const pnlBySymbol = Object.entries(bySymbol)
    .map(([symbol, pnl]) => ({ symbol, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  res.json({
    total,
    totalPnl:  Math.round(totalPnl * 100) / 100,
    winRate:   Math.round(winRate * 10) / 10,
    winners:   winners.length,
    losers:    losers.length,
    avgWin:    Math.round(avgWin * 100) / 100,
    avgLoss:   Math.round(avgLoss * 100) / 100,
    bestTrade,
    worstTrade,
    equityCurve,
    pnlByMonth,
    pnlBySymbol,
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
  const { symbol, date, direction, entry_price, exit_price, quantity, strategy, tags, notes, status } = req.body;

  if (!symbol || !date || !direction || entry_price == null || !quantity) {
    return res.status(400).json({ error: 'Missing required fields: symbol, date, direction, entry_price, quantity' });
  }

  const derivedStatus = status || (exit_price != null ? 'closed' : 'open');

  const result = db.prepare(`
    INSERT INTO trades (symbol, date, direction, entry_price, exit_price, quantity, strategy, tags, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    symbol.toUpperCase(), date, direction,
    entry_price, exit_price ?? null, quantity,
    strategy || null, JSON.stringify(tags || []),
    notes || null, derivedStatus
  );

  res.status(201).json(parseTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(result.lastInsertRowid)));
});

// PUT /api/trades/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Trade not found' });

  const { symbol, date, direction, entry_price, exit_price, quantity, strategy, tags, notes, status } = req.body;

  db.prepare(`
    UPDATE trades SET
      symbol = ?, date = ?, direction = ?, entry_price = ?, exit_price = ?,
      quantity = ?, strategy = ?, tags = ?, notes = ?, status = ?
    WHERE id = ?
  `).run(
    (symbol ?? existing.symbol).toUpperCase(),
    date        ?? existing.date,
    direction   ?? existing.direction,
    entry_price ?? existing.entry_price,
    exit_price  !== undefined ? (exit_price ?? null) : existing.exit_price,
    quantity    ?? existing.quantity,
    strategy    !== undefined ? (strategy  || null) : existing.strategy,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    notes       !== undefined ? (notes     || null) : existing.notes,
    status      ?? existing.status,
    req.params.id
  );

  res.json(parseTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id)));
});

// DELETE /api/trades/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Trade not found' });
  db.prepare('DELETE FROM trades WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
