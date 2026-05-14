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

  // ── Discipline metrics ─────────────────────────────────────────────────────────
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

// ── Trade Comments ──────────────────────────────────────────────────────────────

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

const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function lastTuesdayOfMonth(year, mon) {
  const last = new Date(year, mon + 1, 0);
  const sub  = (last.getDay() - 2 + 7) % 7; // days back to Tuesday (2)
  return new Date(year, mon, last.getDate() - sub);
}

// Handles all NSE expiry formats stored by the app:
//   "May '26"   → monthly: last Tuesday of May 2026
//   "19 May"    → weekly:  nearest future May 19
//   "29MAY2026" → standard NSE string
//   ISO / other → native Date parse
function parseExpiry(str) {
  if (!str) return null;

  // "May '26"
  const monthly = str.match(/^([A-Za-z]{3})\s*'(\d{2})$/);
  if (monthly) {
    const mon = MONTH_MAP[monthly[1].toLowerCase()];
    if (mon !== undefined) return lastTuesdayOfMonth(2000 + parseInt(monthly[2], 10), mon);
  }

  // "19 May"
  const weekly = str.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (weekly) {
    const day = parseInt(weekly[1], 10);
    const mon = MONTH_MAP[weekly[2].toLowerCase()];
    if (mon !== undefined) {
      const now = new Date();
      let d = new Date(now.getFullYear(), mon, day);
      if (d < now) d = new Date(now.getFullYear() + 1, mon, day);
      return d;
    }
  }

  // "29MAY2026"
  const nse = str.match(/^(\d{2})([A-Za-z]{3})(\d{4})$/);
  if (nse) {
    const mon = MONTH_MAP[nse[2].toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(nse[3], 10), mon, parseInt(nse[1], 10));
  }

  const d = new Date(str);
  return isNaN(d) ? null : d;
}

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

// ── Black-Scholes Greeks ──────────────────────────────────────────────────────

function normCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
  return 0.5 * (1 + sign * y);
}
function normPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function bsmGreeks(S, K, T, sigma, type, r = 0.065) {
  const intrinsic = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (T <= 0 || sigma <= 0) {
    return { price: intrinsic, intrinsic, timeValue: 0, delta: type === 'CE' ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1    = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrtT);
  const d2    = d1 - sigma * sqrtT;
  const eRt   = Math.exp(-r * T);
  const Nd1   = normCDF(d1), Nd2 = normCDF(d2);
  const pd1   = normPDF(d1);

  let price, delta, theta;
  if (type === 'CE') {
    price = S * Nd1 - K * eRt * Nd2;
    delta = Nd1;
    theta = (-(S * pd1 * sigma) / (2 * sqrtT) - r * K * eRt * Nd2) / 365;
  } else {
    price = K * eRt * normCDF(-d2) - S * normCDF(-d1);
    delta = Nd1 - 1;
    theta = (-(S * pd1 * sigma) / (2 * sqrtT) + r * K * eRt * normCDF(-d2)) / 365;
  }
  const gamma    = pd1 / (S * sigma * sqrtT);
  const vega     = S * pd1 * sqrtT * 0.01; // per 1% IV move
  const timeValue = Math.max(0, price - intrinsic);
  return { price: Math.max(0, price), intrinsic, timeValue, delta, gamma, theta, vega };
}

// POST /api/trades/:id/exit-plan  — generate (or refresh) AI exit plan
router.post('/:id/exit-plan', async (req, res) => {
  try {
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

  // ── Pre-compute trade mechanics so Claude doesn't have to ──────────────────
  const spot = nifty?.latest ?? null;

  // Candlestick patterns from stored sessions
  const patterns = detectPatterns(sessions.slice(-6));

  // Net debit (+) or credit (-) in rupees
  const netPremiumRs = legs.reduce((sum, l) => {
    const sign = l.side === 'B' ? 1 : -1;
    return sum + sign * (l.entry_price || 0) * LOT_SIZE * (l.lots || 1);
  }, 0);
  const isDebit  = netPremiumRs > 0;
  const netPerUnit = legs.length > 0
    ? legs.reduce((s, l) => s + (l.side === 'B' ? 1 : -1) * (l.entry_price || 0), 0)
    : null;

  // Identify long/short strikes for spread strategies
  const buyLegs  = legs.filter(l => l.side === 'B');
  const sellLegs = legs.filter(l => l.side === 'S');
  const longStrike  = buyLegs.length  ? Math.min(...buyLegs.map(l => l.strike))  : null;
  const shortStrike = sellLegs.length ? Math.max(...sellLegs.map(l => l.strike)) : null;

  // Breakeven
  let breakeven = null;
  const legType = buyLegs[0]?.type;
  if (longStrike && netPerUnit != null) {
    breakeven = legType === 'CE'
      ? Math.round(longStrike + Math.abs(netPerUnit))
      : Math.round(longStrike - Math.abs(netPerUnit));
  }

  // Max profit / max loss for spread (pre-computed, use these in prompt)
  const totalLots   = legs.reduce((s, l) => s + (l.lots || 1), 0) / 2; // lots per side
  const spreadWidth = (longStrike && shortStrike) ? Math.abs(shortStrike - longStrike) : null;
  const maxGrossRs  = spreadWidth ? spreadWidth * totalLots * LOT_SIZE : null;
  const maxProfitRs = maxGrossRs  ? Math.round(maxGrossRs - Math.abs(netPremiumRs))  : null;
  const maxLossRs   = Math.round(Math.abs(netPremiumRs));
  const roiPct      = maxProfitRs != null ? ((maxProfitRs / maxLossRs) * 100).toFixed(1) : null;

  // Spot vs key strikes
  const spotVsLong  = spot && longStrike  ? (spot - longStrike).toFixed(0)  : null;
  const spotVsShort = spot && shortStrike ? (spot - shortStrike).toFixed(0) : null;
  const spotVsBE    = spot && breakeven   ? (spot - breakeven).toFixed(0)   : null;

  // NIFTY move since entry
  const niftyAtEntry = sessions.find(s => s.date === trade.date)?.close;
  const niftyMovePct = niftyAtEntry && spot
    ? ((spot - niftyAtEntry) / niftyAtEntry * 100).toFixed(2)
    : null;

  // Build prompt
  const today = new Date().toISOString().split('T')[0];

  // Resolve expiry to a real date using format-aware parser
  const expiryStr  = legs.map(l => l.expiry).filter(Boolean)[0] || null;
  const expiryDate = parseExpiry(expiryStr);
  const dte        = expiryDate
    ? Math.round((expiryDate.getTime() - new Date(today).getTime()) / 86400000)
    : null;
  const expiryIso  = expiryDate ? expiryDate.toISOString().split('T')[0] : null;

  const legsText = legs.map(l =>
    `  ${l.side === 'B' ? 'BUY' : 'SELL'} ${l.lots} lot(s) ${l.strike} ${l.type}` +
    `  expiry: ${l.expiry || 'unknown'}${expiryIso ? ` (= ${expiryIso})` : ''} @ ₹${l.entry_price}`
  ).join('\n');

  // ── Greeks & option value per leg (Black-Scholes) ──────────────────────────
  const iv     = vix?.latest ? vix.latest / 100 : (hv10 ? parseFloat(hv10) / 100 : 0.15);
  const T_bsm  = dte != null && dte > 0 ? dte / 365 : null;

  const legGreeks = legs.map(l => {
    if (!spot || !l.strike || !l.type || T_bsm === null) return null;
    const g    = bsmGreeks(spot, l.strike, T_bsm, iv, l.type);
    const sign = l.side === 'B' ? 1 : -1;
    const n    = (l.lots || 1) * LOT_SIZE;
    return { ...g, sign, n, strike: l.strike, type: l.type, side: l.side, lots: l.lots };
  });

  const validGreeks = legGreeks.filter(Boolean);
  const netDelta    = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.delta * g.n, 0) : null;
  const netTheta    = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.theta * g.n, 0) : null;
  const netGamma    = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.gamma * g.n, 0) : null;
  const netVega     = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.vega  * g.n, 0) : null;
  const netIntrinsic = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.intrinsic * g.n, 0) : null;
  const netTheoValue = validGreeks.length ? validGreeks.reduce((s, g) => s + g.sign * g.price * g.n, 0) : null;

  const legGreeksText = validGreeks.map(g =>
    `    ${g.side === 'B' ? 'BUY' : 'SELL'} ${g.strike} ${g.type}: ` +
    `Δ ${g.delta.toFixed(3)}  Θ ${g.theta.toFixed(2)}/day  Γ ${g.gamma.toFixed(4)}  V ${g.vega.toFixed(2)}/1%IV` +
    `  intrinsic ₹${g.intrinsic.toFixed(1)}  time ₹${g.timeValue.toFixed(1)}`
  ).join('\n');

  const prompt = `You are an expert NIFTY options trader. Provide a precise, actionable exit plan for the trade below.
Use ONLY the pre-computed figures provided — do NOT recalculate or second-guess them.
CRITICAL: Use ONLY the expiry date stated in the legs below. Never guess, infer, or override it.

TODAY: ${today}

TRADE:
  Instrument:  ${trade.instrument}
  Strategy:    ${trade.strategy || 'Options Trade'}
  Entry Date:  ${trade.date}
  Status:      ${trade.status}
  Structure:   ${isDebit ? 'DEBIT spread (premium paid — theta works AGAINST this position)' : 'CREDIT spread (premium received — theta works FOR this position)'}
  Net premium: ${isDebit ? 'Paid' : 'Received'} ₹${Math.abs(netPremiumRs).toFixed(0)} total
  Legs:
${legsText}

PRE-COMPUTED TRADE MECHANICS — use ONLY these figures, do NOT recalculate:
  Expiry date:   ${expiryIso ?? expiryStr ?? 'not specified in legs'}
  DTE (days to expiry from today): ${dte != null ? dte : 'unknown'}
  Lot size:      ${LOT_SIZE} units per lot
  Long strike:   ${longStrike ?? '—'}  (${legType === 'CE' ? 'Call' : 'Put'})
  Short strike:  ${shortStrike ?? '—'}
  Spread width:  ${spreadWidth ?? '—'} pts
  Breakeven:     ${breakeven ?? '—'} (NIFTY must be ${legType === 'CE' ? 'above' : 'below'} this at expiry to profit)
  Max loss:      ₹${maxLossRs} (premium paid — full loss if NIFTY below long strike at expiry)
  Max profit:    ₹${maxProfitRs ?? '—'} (if NIFTY at/above short strike at expiry)
  ROI at max profit: ${roiPct ?? '—'}%
  NIFTY spot now: ${spot?.toFixed(2) ?? 'unavailable'}
  Spot vs long strike:  ${spotVsLong != null ? (Number(spotVsLong) >= 0 ? '+' : '') + spotVsLong + ' pts (' + (Number(spotVsLong) >= 0 ? 'ABOVE' : 'BELOW') + ')' : '—'}
  Spot vs short strike: ${spotVsShort != null ? (Number(spotVsShort) >= 0 ? '+' : '') + spotVsShort + ' pts (' + (Number(spotVsShort) >= 0 ? 'ABOVE' : 'BELOW') + ')' : '—'}
  Spot vs breakeven:    ${spotVsBE != null ? (Number(spotVsBE) >= 0 ? '+' : '') + spotVsBE + ' pts (' + (Number(spotVsBE) >= 0 ? 'ABOVE — trade profitable at expiry' : 'BELOW — trade losing at expiry') + ')' : '—'}
  NIFTY move since entry: ${niftyMovePct != null ? (Number(niftyMovePct) >= 0 ? '+' : '') + niftyMovePct + '%' : '—'}

GREEKS & OPTION VALUE (Black-Scholes, IV = ${(iv * 100).toFixed(1)}% = ${vix?.latest ? 'live VIX' : 'HV10 fallback'}):
${legGreeksText || '  (insufficient data for Greeks — DTE or spot unavailable)'}
  ── NET POSITION ──
  Net Delta:     ${netDelta != null ? netDelta.toFixed(2) + ' (₹' + (netDelta).toFixed(0) + ' P&L per 1 pt NIFTY move)' : '—'}
  Net Theta:     ${netTheta != null ? '₹' + netTheta.toFixed(2) + '/day (' + (netTheta > 0 ? 'earning' : 'losing') + ' time value daily)' : '—'}
  Net Gamma:     ${netGamma != null ? netGamma.toFixed(4) : '—'}
  Net Vega:      ${netVega  != null ? '₹' + netVega.toFixed(2) + ' per 1% IV move' : '—'}
  Intrinsic value (spread): ${netIntrinsic != null ? '₹' + netIntrinsic.toFixed(0) : '—'}
  Theoretical value (spread): ${netTheoValue != null ? '₹' + netTheoValue.toFixed(0) : '—'}
  Time value (spread): ${netIntrinsic != null && netTheoValue != null ? '₹' + (netTheoValue - netIntrinsic).toFixed(0) : '—'}

VOLATILITY & MOMENTUM:
  India VIX:  ${vix?.latest?.toFixed(2) ?? 'unavailable'}  (${vix?.changePct != null ? (Number(vix.changePct) >= 0 ? '+' : '') + vix.changePct + '% today' : ''})
  ${vix?.latest && hv10 ? `VIX/HV ratio: ${(vix.latest / parseFloat(hv10)).toFixed(2)}× — options are ${vix.latest / parseFloat(hv10) > 1.2 ? 'OVERPRICED vs history (sell bias)' : vix.latest / parseFloat(hv10) < 0.8 ? 'CHEAP vs history (buy bias)' : 'fairly priced'}` : ''}
  HV-10: ${hv10 ?? '—'}%  HV-20: ${hv20 ?? '—'}%
  ATR (14d): ${atr ?? '—'} pts/day
  5-day trend: ${trendPct != null ? (Number(trendPct) >= 0 ? '+' : '') + trendPct + '%' : '—'}
  Weekly expected move: ${weeklyMove ? `±${weeklyMove} pts` : '—'}

GLOBAL MARKETS:
  S&P 500:      ${sp500 ? `${Number(sp500.changePct) >= 0 ? '+' : ''}${sp500.changePct}%` : 'unavailable'}
  Crude Oil:    ${crude ? `$${crude.latest?.toFixed(1)}  (${Number(crude.changePct) >= 0 ? '+' : ''}${crude.changePct}%)` : 'unavailable'}
  Dollar Index: ${dxy   ? `${dxy.latest?.toFixed(2)}  (${Number(dxy.changePct) >= 0 ? '+' : ''}${dxy.changePct}%)` : 'unavailable'}

RECENT CANDLESTICK PATTERNS (last 6 sessions):
${patterns.map(p => '  ' + p).join('\n')}

Respond in this EXACT format with no other text:

## Outlook
[2-3 lines. State whether the trade is currently above/below breakeven, net delta direction, and whether momentum is helping or hurting.]

## Profit Target
[Specific NIFTY level to exit for profit. State the spread's theoretical value at that level and % of max profit captured.]

## Stop Loss
[Specific NIFTY level or % loss on premium. Reference the net delta to estimate how many NIFTY points correspond to the stop-loss amount.]

## Time-based Rules
[Use the EXACT expiry date and DTE from the pre-computed facts above — never guess the expiry. Give specific calendar dates. State the net theta impact in rupees per day clearly: "this position loses/earns ₹X/day from time decay". Highlight theta acceleration in final week.]

## If Market Moves Against You
[Concrete adjustment with specific NIFTY levels. Reference vega: if IV spikes/drops, how does that affect the spread value?]

## Key Levels to Watch
[2-4 support/resistance levels with brief reasoning]

## Risk Rating
[One line: Low / Medium / High risk, with reason referencing Greeks — e.g. delta exposure, theta bleed rate, vega risk]`;

  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new (Anthropic.default ?? Anthropic)({ apiKey });
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
    if (!res.headersSent) res.status(502).json({ error: err.message || 'Claude API call failed' });
  }
});

// GET /api/trades/:id/exit-plan  — fetch saved plan
router.get('/:id/exit-plan', (req, res) => {
  const row = db.prepare('SELECT exit_plan, exit_plan_at FROM trades WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Trade not found' });
  res.json({ exit_plan: row.exit_plan || null, exit_plan_at: row.exit_plan_at || null });
});

module.exports = router;
