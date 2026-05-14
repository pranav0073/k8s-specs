const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');

function getUploadsDir() {
  return process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
}

function saveImageFile(base64Data, originalFilename) {
  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const ext      = (originalFilename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, safeName), Buffer.from(base64Data, 'base64'));
  return safeName;
}

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

  // ── Discipline metrics ──────────────────────────────────────────────────
  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : null;
  const expectancy   = total > 0
    ? Math.round(((winners.length / total) * avgWin + (losers.length / total) * avgLoss) * 100) / 100
    : null;

  // Max drawdown from equity curve
  let peak = 0, maxDrawdown = 0;
  for (const pt of equityCurve) {
    if (pt.pnl > peak) peak = pt.pnl;
    const dd = peak - pt.pnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Win/loss streaks
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  let ws = 0, ls = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const t of sorted) {
    if ((t.pnl || 0) > 0) { ws++; ls = 0; if (ws > maxWinStreak) maxWinStreak = ws; }
    else                   { ls++; ws = 0; if (ls > maxLossStreak) maxLossStreak = ls; }
  }

  // Avg hold duration (days)
  const withClose = trades.filter(t => t.close_date && t.date);
  const avgHoldDays = withClose.length > 0
    ? Math.round(withClose.reduce((s, t) => {
        const [y1,m1,d1] = t.date.split('-').map(Number);
        const [y2,m2,d2] = t.close_date.split('-').map(Number);
        return s + (new Date(y2,m2-1,d2) - new Date(y1,m1-1,d1)) / 86400000;
      }, 0) / withClose.length * 10) / 10
    : null;

  // Win rate by strategy
  const stratMap = {};
  trades.forEach(t => {
    const key = t.strategy || 'Other';
    if (!stratMap[key]) stratMap[key] = { trades: 0, wins: 0, pnl: 0 };
    stratMap[key].trades++;
    if ((t.pnl || 0) > 0) stratMap[key].wins++;
    stratMap[key].pnl += (t.pnl || 0);
  });
  const winByStrategy = Object.entries(stratMap)
    .map(([strategy, s]) => ({
      strategy,
      trades:  s.trades,
      wins:    s.wins,
      winRate: Math.round((s.wins / s.trades) * 100),
      pnl:     Math.round(s.pnl * 100) / 100,
    }))
    .sort((a, b) => b.trades - a.trades);

  // P&L by instrument
  const instrMap = {};
  trades.forEach(t => {
    if (!instrMap[t.instrument]) instrMap[t.instrument] = { trades: 0, wins: 0, pnl: 0 };
    instrMap[t.instrument].trades++;
    if ((t.pnl || 0) > 0) instrMap[t.instrument].wins++;
    instrMap[t.instrument].pnl += (t.pnl || 0);
  });
  const pnlByInstrument = Object.entries(instrMap)
    .map(([instrument, s]) => ({
      instrument,
      trades:  s.trades,
      winRate: Math.round((s.wins / s.trades) * 100),
      pnl:     Math.round(s.pnl * 100) / 100,
    }))
    .sort((a, b) => b.trades - a.trades);

  // Trades by day of week
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowMap = {};
  trades.forEach(t => {
    const [y,m,d] = t.date.split('-').map(Number);
    const day = DOW[new Date(y, m-1, d).getDay()];
    if (!dowMap[day]) dowMap[day] = { trades: 0, wins: 0, pnl: 0 };
    dowMap[day].trades++;
    if ((t.pnl || 0) > 0) dowMap[day].wins++;
    dowMap[day].pnl += (t.pnl || 0);
  });
  const tradesByDow = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .filter(day => dowMap[day])
    .map(day => ({
      day,
      trades:  dowMap[day].trades,
      winRate: Math.round((dowMap[day].wins / dowMap[day].trades) * 100),
      pnl:     Math.round(dowMap[day].pnl * 100) / 100,
    }));

  res.json({
    total,
    totalPnl:      Math.round(totalPnl * 100) / 100,
    winRate:       Math.round(winRate * 10) / 10,
    winners:       winners.length,
    losers:        losers.length,
    avgWin:        Math.round(avgWin * 100) / 100,
    avgLoss:       Math.round(avgLoss * 100) / 100,
    profitFactor,
    expectancy,
    maxDrawdown:   Math.round(maxDrawdown * 100) / 100,
    maxWinStreak,
    maxLossStreak,
    avgHoldDays,
    bestTrade,
    worstTrade,
    equityCurve,
    pnlByMonth,
    pnlByStrategy,
    winByStrategy,
    pnlByInstrument,
    tradesByDow,
  });
});

// GET /api/trades/bulk/preview?from=&to=  — count without deleting
router.get('/bulk/preview', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const count = db.prepare('SELECT COUNT(*) as n FROM trades WHERE date >= ? AND date <= ?').get(from, to).n;
  res.json({ count });
});

// DELETE /api/trades/bulk?from=YYYY-MM-DD&to=YYYY-MM-DD
router.delete('/bulk', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const rows = db.prepare('SELECT id FROM trades WHERE date >= ? AND date <= ?').all(from, to);
  for (const { id } of rows) {
    db.prepare('DELETE FROM trade_comments WHERE trade_id = ?').run(id);
    db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  }
  res.json({ deleted: rows.length });
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

function parseComment(row) {
  return { ...row, images: JSON.parse(row.images || '[]') };
}

// GET /api/trades/:id/comments
router.get('/:id/comments', (req, res) => {
  const comments = db.prepare(
    'SELECT * FROM trade_comments WHERE trade_id = ? ORDER BY date ASC'
  ).all(req.params.id);
  res.json(comments.map(parseComment));
});

// POST /api/trades/:id/comments  (upsert by trade_id + date)
router.post('/:id/comments', (req, res) => {
  const { date, comment, emotion } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const existing = db.prepare(
    'SELECT * FROM trade_comments WHERE trade_id = ? AND date = ?'
  ).get(req.params.id, date);

  if (existing) {
    db.prepare('UPDATE trade_comments SET comment=?, emotion=? WHERE id=?')
      .run(comment || null, emotion || null, existing.id);
  } else {
    db.prepare('INSERT INTO trade_comments (trade_id, date, comment, emotion) VALUES (?, ?, ?, ?)')
      .run(req.params.id, date, comment || null, emotion || null);
  }
  res.json(parseComment(
    db.prepare('SELECT * FROM trade_comments WHERE trade_id = ? AND date = ?').get(req.params.id, date)
  ));
});

// DELETE /api/trades/:id/comments/:cid
router.delete('/:id/comments/:cid', (req, res) => {
  db.prepare('DELETE FROM trade_comments WHERE id = ? AND trade_id = ?')
    .run(req.params.cid, req.params.id);
  res.json({ success: true });
});

// POST /api/trades/:id/comments/:date/images
router.post('/:id/comments/:date/images', (req, res) => {
  const { data, filename } = req.body;
  if (!data || !filename) return res.status(400).json({ error: 'data and filename required' });

  const safeName = saveImageFile(data, filename);
  const { id, date } = req.params;

  const existing = db.prepare('SELECT * FROM trade_comments WHERE trade_id = ? AND date = ?').get(id, date);
  if (existing) {
    const images = JSON.parse(existing.images || '[]');
    images.push(safeName);
    db.prepare('UPDATE trade_comments SET images = ? WHERE id = ?').run(JSON.stringify(images), existing.id);
  } else {
    db.prepare('INSERT INTO trade_comments (trade_id, date, images) VALUES (?, ?, ?)').run(id, date, JSON.stringify([safeName]));
  }

  res.json({ filename: safeName, url: `/uploads/${safeName}` });
});

// DELETE /api/trades/:id/comments/:date/images/:filename
router.delete('/:id/comments/:date/images/:filename', (req, res) => {
  const { id, date, filename } = req.params;

  const filePath = path.join(getUploadsDir(), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const row = db.prepare('SELECT * FROM trade_comments WHERE trade_id = ? AND date = ?').get(id, date);
  if (row) {
    const images = JSON.parse(row.images || '[]').filter(f => f !== filename);
    db.prepare('UPDATE trade_comments SET images = ? WHERE id = ?').run(JSON.stringify(images), row.id);
  }

  res.json({ success: true });
});

// ── AI Exit Plan ──────────────────────────────────────────────────────────────

async function fetchYahoo(symbol, range = '5d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${symbol} → ${r.status}`);
  const j      = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const latest = closes.at(-1);
  const prev   = closes.at(-2);
  return { latest, prev, changePct: prev ? ((latest - prev) / prev * 100).toFixed(2) : null };
}

function detectPatterns(sessions) {
  const out = [];
  const s = [...sessions].reverse(); // oldest → newest
  for (let i = 0; i < s.length; i++) {
    const { date, open: o, high: h, low: l, close: c } = s[i];
    if (o == null || h == null || l == null || c == null) continue;
    const body = Math.abs(c - o);
    const range = h - l || 0.001;
    const upper = h - Math.max(o, c);
    const lower = Math.min(o, c) - l;
    const bull   = c > o;
    if (body / range < 0.1)                               out.push(`${date}: Doji (indecision)`);
    else if (lower > 2 * body && upper < body * 0.3)      out.push(`${date}: ${bull ? 'Hammer (bullish reversal)' : 'Hanging Man (bearish reversal)'}`);
    else if (upper > 2 * body && lower < body * 0.3)      out.push(`${date}: ${bull ? 'Inverted Hammer' : 'Shooting Star (bearish reversal)'}`);
    else if (body / range > 0.75)                          out.push(`${date}: ${bull ? 'Bullish' : 'Bearish'} Marubozu (strong momentum)`);
    if (i > 0) {
      const p = s[i - 1];
      if (p.open != null && p.close != null) {
        const pBull = p.close > p.open;
        if (!bull && pBull && o >= p.close && c <= p.open) out.push(`${date}: Bearish Engulfing`);
        if ( bull && !pBull && o <= p.close && c >= p.open) out.push(`${date}: Bullish Engulfing`);
      }
    }
  }
  return out.length ? out : ['No notable patterns in recent sessions'];
}

// POST /api/trades/:id/exit-plan  — generate (or refresh) AI exit plan
router.post('/:id/exit-plan', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your environment and restart the backend.' });
  }

  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const legs = JSON.parse(trade.legs || '[]');

  // Fetch all live market data in parallel; degrade gracefully on failure
  const [niftyR, vixR, sp500R, crudeR, dxyR] = await Promise.allSettled([
    fetchYahoo('^NSEI',      '10d'),
    fetchYahoo('^INDIAVIX',  '5d'),
    fetchYahoo('^GSPC',      '5d'),
    fetchYahoo('CL=F',       '5d'),
    fetchYahoo('DX-Y.NYB',   '5d'),
  ]);

  const nifty = niftyR.status === 'fulfilled' ? niftyR.value : null;
  const vix   = vixR.status   === 'fulfilled' ? vixR.value   : null;
  const sp500 = sp500R.status === 'fulfilled' ? sp500R.value : null;
  const crude = crudeR.status === 'fulfilled' ? crudeR.value : null;
  const dxy   = dxyR.status   === 'fulfilled' ? dxyR.value   : null;

  // Compute HV and ATR from stored sessions
  const sessions = db.prepare(
    'SELECT date, open, high, low, close FROM market_sessions WHERE close IS NOT NULL ORDER BY date ASC LIMIT 30'
  ).all();
  const closes  = sessions.map(s => s.close);
  const logRets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  function hv(n) {
    const r = logRets.slice(-n);
    if (r.length < 2) return null;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v    = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    return (Math.sqrt(v * 252) * 100).toFixed(1);
  }
  const atrRows = sessions.slice(-14).filter(s => s.high && s.low);
  const atr     = atrRows.length ? Math.round(atrRows.reduce((s, r) => s + r.high - r.low, 0) / atrRows.length) : null;
  const hv10    = hv(10);
  const hv20    = hv(20);

  // Trend
  const last6  = closes.slice(-6);
  const trendPct = last6.length >= 2
    ? (((last6.at(-1) - last6[0]) / last6[0]) * 100).toFixed(2)
    : null;

  // Weekly expected move
  const volForMove = vix?.latest ?? (hv10 ? parseFloat(hv10) : null);
  const weeklyMove = volForMove && nifty?.latest
    ? Math.round(nifty.latest * (volForMove / 100) * Math.sqrt(5 / 252))
    : null;

  // Candlestick patterns
  const recentSessions = sessions.slice(-6);
  const patterns = detectPatterns(recentSessions);

  // Build prompt
  const today = new Date().toISOString().split('T')[0];
  const legsText = legs.map(l =>
    `  ${l.side === 'B' ? 'BUY' : 'SELL'} ${l.lots}L ${l.strike}${l.type} ${l.expiry || ''} @ ₹${l.entry_price}`
  ).join('\n');

  const niftyAtEntry = sessions.find(s => s.date === trade.date)?.close;
  const niftyMove = niftyAtEntry && nifty?.latest
    ? ((nifty.latest - niftyAtEntry) / niftyAtEntry * 100).toFixed(2)
    : null;

  const prompt = `You are an expert NIFTY options trader. Provide a precise, actionable exit plan for the trade below.

TODAY: ${today}

TRADE:
  Instrument: ${trade.instrument}
  Strategy:   ${trade.strategy || 'Options Trade'}
  Entry Date: ${trade.date}
  Status:     ${trade.status}
  Legs:
${legsText}

LIVE NIFTY:
  Spot: ${nifty?.latest?.toFixed(2) ?? 'unavailable'}${niftyAtEntry ? `  (entry day close: ${niftyAtEntry}, move since entry: ${niftyMove}%)` : ''}
  ATR (14d): ${atr ?? '—'} pts
  HV-10: ${hv10 ?? '—'}%  HV-20: ${hv20 ?? '—'}%
  5-day trend: ${trendPct != null ? (trendPct > 0 ? '+' : '') + trendPct + '%' : '—'}
  Weekly expected move: ${weeklyMove ? `±${weeklyMove} pts` : '—'}

INDIA VIX:
  Current: ${vix?.latest?.toFixed(2) ?? 'unavailable'}  (${vix?.changePct != null ? (vix.changePct > 0 ? '+' : '') + vix.changePct + '% today' : ''})
  ${vix?.latest && hv10 ? `VIX/HV ratio: ${(vix.latest / parseFloat(hv10)).toFixed(2)}× ${vix.latest / parseFloat(hv10) > 1.2 ? '→ options overpriced (sell bias)' : vix.latest / parseFloat(hv10) < 0.8 ? '→ options cheap (buy bias)' : '→ fairly priced'}` : ''}

GLOBAL MARKETS (today):
  S&P 500:      ${sp500 ? `${sp500.changePct > 0 ? '+' : ''}${sp500.changePct}%` : 'unavailable'}
  Crude Oil:    ${crude ? `$${crude.latest?.toFixed(1)}  (${crude.changePct > 0 ? '+' : ''}${crude.changePct}%)` : 'unavailable'}
  Dollar Index: ${dxy   ? `${dxy.latest?.toFixed(2)}  (${dxy.changePct > 0 ? '+' : ''}${dxy.changePct}%)` : 'unavailable'}

RECENT CANDLESTICK PATTERNS (last 6 sessions):
${patterns.map(p => '  ' + p).join('\n')}

Respond in this EXACT format with no other text:

## Outlook
[2-3 lines: is the trade working, momentum in your favour?]

## Profit Target
[Specific NIFTY level to exit for profit. Expected premium value at that level if possible.]

## Stop Loss
[Specific NIFTY level or % loss on premium to trigger exit. Be precise.]

## Time-based Rules
[When to exit based on DTE — e.g. "exit by Wed if <50% max profit", theta decay guidance]

## If Market Moves Against You
[Concrete adjustment or defensive action with specific levels]

## Key Levels to Watch
[2-4 support/resistance levels with brief reasoning]

## Risk Rating
[One line: Low / Medium / High risk, with reason]`;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey });
    const message   = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    });
    const plan = message.content[0]?.text || '';
    const now  = new Date().toISOString();
    db.prepare('UPDATE trades SET exit_plan = ?, exit_plan_at = ? WHERE id = ?').run(plan, now, trade.id);
    res.json({ exit_plan: plan, exit_plan_at: now });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Claude API call failed' });
  }
});

// GET /api/trades/:id/exit-plan  — fetch saved plan
router.get('/:id/exit-plan', (req, res) => {
  const row = db.prepare('SELECT exit_plan, exit_plan_at FROM trades WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Trade not found' });
  res.json({ exit_plan: row.exit_plan || null, exit_plan_at: row.exit_plan_at || null });
});

module.exports = router;
