const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const router  = express.Router();

function parseImages(row) {
  return { ...row, images: JSON.parse(row.images || '[]') };
}

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
  res.json(db.prepare(query).all(...params).map(parseImages));
});

// GET /api/sessions/quote?date=YYYY-MM-DD  — fetch NIFTY OHLC from Yahoo Finance
router.get('/quote', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=30d&interval=1d&events=history';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data in response');

    const timestamps = result.timestamp;
    const quote      = result.indicators.quote[0];
    const adjClose   = result.indicators.adjclose?.[0]?.adjclose;

    // Find the index matching the requested date.
    // NSE timestamps from Yahoo Finance are midnight IST (UTC+5:30), so we add
    // the IST offset before extracting the calendar date to avoid off-by-one errors.
    const IST_OFFSET = 5.5 * 3600; // seconds
    const idx = timestamps.findIndex(ts => {
      const d = new Date((ts + IST_OFFSET) * 1000);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}` === date;
    });

    if (idx === -1) return res.status(404).json({ error: `No NIFTY data found for ${date}. Market may have been closed.` });

    const round = v => v != null ? Math.round(v * 100) / 100 : null;
    const prevClose = idx > 0 ? round(quote.close[idx - 1]) : round(result.meta.chartPreviousClose);

    res.json({
      date,
      open:       round(quote.open[idx]),
      high:       round(quote.high[idx]),
      low:        round(quote.low[idx]),
      close:      round(quote.close[idx]),
      prev_close: prevClose,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to fetch NIFTY data' });
  }
});

// GET /api/sessions/analysis  — HV / ATR / range forecast / strategy suggestions
router.get('/analysis', (req, res) => {
  const rows = db.prepare(
    'SELECT date, open, high, low, close FROM market_sessions WHERE close IS NOT NULL ORDER BY date ASC LIMIT 60'
  ).all();

  if (rows.length < 3) {
    return res.json({ insufficient: true, dataPoints: rows.length });
  }

  // ── ATR (up to 14 days) ─────────────────────────────────────────────────
  const atrSample = rows.slice(-14).filter(r => r.high != null && r.low != null);
  const atr = atrSample.length
    ? atrSample.reduce((s, r) => s + (r.high - r.low), 0) / atrSample.length
    : null;

  // ── Historical Volatility ───────────────────────────────────────────────
  const closes = rows.map(r => r.close);
  const logRets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));

  function hv(n) {
    const r = logRets.slice(-n);
    if (r.length < 2) return null;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    return Math.sqrt(variance * 252) * 100;
  }

  const hv10 = hv(10);
  const hv20 = hv(20);
  const hvUsed = hv10 ?? hv20;

  // ── Current close & weekly expected move ───────────────────────────────
  const currentClose = closes[closes.length - 1];
  const latestDate   = rows[rows.length - 1].date;

  // Weekly EM = close × HV × √(5/252); fall back to ATR × √5
  const weeklyMove = hvUsed
    ? currentClose * (hvUsed / 100) * Math.sqrt(5 / 252)
    : (atr ? atr * Math.sqrt(5) : null);

  // ── Trend: 5-day price momentum ────────────────────────────────────────
  const trendWindow = closes.slice(-6);
  const trendPct = trendWindow.length >= 2
    ? ((trendWindow.at(-1) - trendWindow[0]) / trendWindow[0]) * 100
    : 0;
  const trend =
    trendPct >  1.5 ? 'strong_bullish' :
    trendPct >  0.4 ? 'bullish'        :
    trendPct < -1.5 ? 'strong_bearish' :
    trendPct < -0.4 ? 'bearish'        : 'sideways';

  // ── HV level label ─────────────────────────────────────────────────────
  const hvLevel = !hvUsed ? 'unknown' : hvUsed > 20 ? 'high' : hvUsed < 12 ? 'low' : 'normal';

  // ── Weekly range projections (weeks 1-4) ───────────────────────────────
  const r50 = v => Math.round(v / 50) * 50;
  const weeklyRanges = weeklyMove ? [1, 2, 3, 4].map(w => {
    const move = weeklyMove * Math.sqrt(w);
    return {
      week: w,
      low:  Math.round(currentClose - move),
      high: Math.round(currentClose + move),
      move: Math.round(move),
    };
  }) : [];

  // ── Strategy suggestions ───────────────────────────────────────────────
  function suggest(name, fit, side, desc, strikes) {
    return { name, fit, side, description: desc, strikes };
  }

  let strategies = [];
  const wm = weeklyMove;
  const cc = currentClose;

  if (hvLevel === 'high') {
    if (trend === 'sideways') {
      strategies = [
        suggest('Iron Condor',    'high',   'sell',    'High IV inflates premium — ideal for selling a range. Sell OTM CE & PE, buy further out for protection.', wm ? `Sell ${r50(cc+wm*0.8)} CE / ${r50(cc-wm*0.8)} PE  •  Buy ${r50(cc+wm*1.3)} CE / ${r50(cc-wm*1.3)} PE` : null),
        suggest('Short Strangle', 'medium', 'sell',    'Sell OTM CE and PE without hedges for higher premium. Use with a hard stop on underlying.',               wm ? `Sell ${r50(cc+wm)} CE / ${r50(cc-wm)} PE` : null),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Bull Call Spread',  'high',   'buy',  'Captures upside move with defined risk. High IV — spread width offsets the inflated debit.',              wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm*0.9)} CE` : null),
        suggest('Short Put (CSP)',   'medium', 'sell', 'Collect rich premium with bullish bias. Obligation to buy NIFTY at the strike if it falls.',              wm ? `Sell ${r50(cc-wm*0.7)} PE` : null),
      ];
    } else {
      strategies = [
        suggest('Bear Put Spread',   'high',   'buy',  'Captures downside with defined risk. High IV makes spread width attractive.',                             wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm*0.9)} PE` : null),
        suggest('Short Call (CC)',   'medium', 'sell', 'Collect rich premium with bearish bias. Profit capped above the sold strike.',                            wm ? `Sell ${r50(cc+wm*0.7)} CE` : null),
      ];
    }
  } else if (hvLevel === 'low') {
    if (trend === 'sideways') {
      strategies = [
        suggest('Long Straddle',  'high',   'buy', 'Cheap options in low-IV environment. Profit if NIFTY makes any large move before expiry.',                   wm ? `Buy ${r50(cc)} CE + ${r50(cc)} PE` : null),
        suggest('Long Strangle', 'medium', 'buy',  'Lower cost than straddle. Needs a bigger move to profit — suitable when a breakout is expected.',             wm ? `Buy ${r50(cc+wm*0.5)} CE + ${r50(cc-wm*0.5)} PE` : null),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Long Call',       'high',   'buy', 'Low IV = cheap calls. Ride the bullish trend with defined risk.',                                            wm ? `Buy ${r50(cc)} CE (ATM)` : null),
        suggest('Bull Call Spread','medium', 'buy', 'Reduce premium outlay by selling OTM call. Still captures most of the upside.',                              wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm)} CE` : null),
      ];
    } else {
      strategies = [
        suggest('Long Put',       'high',   'buy', 'Low IV = cheap puts. Ride the bearish trend with defined risk.',                                              wm ? `Buy ${r50(cc)} PE (ATM)` : null),
        suggest('Bear Put Spread','medium', 'buy', 'Reduce cost by selling OTM put. Captures most of the downside.',                                              wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm)} PE` : null),
      ];
    }
  } else {
    // normal / unknown
    if (trend === 'sideways') {
      strategies = [
        suggest('Iron Condor',      'high',   'sell',    'Classic range-bound play. Collect premium from both sides while NIFTY stays in range.',                 wm ? `Sell ${r50(cc+wm*0.8)} CE / ${r50(cc-wm*0.8)} PE  •  Buy ${r50(cc+wm*1.4)} CE / ${r50(cc-wm*1.4)} PE` : null),
        suggest('Calendar Spread',  'medium', 'neutral', 'Sell near-expiry ATM, buy next-expiry ATM. Profits from time decay as spot stays flat.',                `ATM strike: ${r50(cc)}`),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Bull Call Spread',      'high',   'buy',  'Defined-risk bullish play with moderate IV. Good risk/reward for a trending market.',                 wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm)} CE` : null),
        suggest('Iron Condor (skewed)',  'medium', 'sell', 'Shift strikes higher to give more room on the upside. Collect premium with bullish drift allowance.', wm ? `Sell ${r50(cc+wm)} CE / ${r50(cc-wm*0.5)} PE  •  Buy ${r50(cc+wm*1.6)} CE / ${r50(cc-wm*1.1)} PE` : null),
      ];
    } else {
      strategies = [
        suggest('Bear Put Spread',       'high',   'buy',  'Defined-risk bearish play. Good risk/reward for a trending market.',                                  wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm)} PE` : null),
        suggest('Iron Condor (skewed)',  'medium', 'sell', 'Shift strikes lower to give more room on the downside. Collect premium with bearish drift allowance.',wm ? `Sell ${r50(cc-wm)} PE / ${r50(cc+wm*0.5)} CE  •  Buy ${r50(cc-wm*1.6)} PE / ${r50(cc+wm*1.1)} CE` : null),
      ];
    }
  }

  const round1 = v => v != null ? Math.round(v * 10) / 10 : null;

  res.json({
    currentClose,
    latestDate,
    atr:              atr  ? Math.round(atr)  : null,
    hv10:             round1(hv10),
    hv20:             round1(hv20),
    hvUsed:           round1(hvUsed),
    hvLevel,
    weeklyMove:       weeklyMove ? Math.round(weeklyMove) : null,
    trend,
    trendPct:         Math.round(trendPct * 100) / 100,
    weeklyRanges,
    strategies,
    dataPoints:       rows.length,
  });
});

// GET /api/sessions/:date
router.get('/:date', (req, res) => {
  const session = db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(req.params.date);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(parseImages(session));
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
  res.json(parseImages(db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(date)));
});

// DELETE /api/sessions/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM market_sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/sessions/:date/images  — upload a chart screenshot (base64 JSON)
router.post('/:date/images', (req, res) => {
  const { data, filename } = req.body;
  if (!data || !filename) return res.status(400).json({ error: 'data and filename required' });

  const safeName = saveImageFile(data, filename);

  // ensure session row exists
  const existing = db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(req.params.date);
  if (existing) {
    const images = JSON.parse(existing.images || '[]');
    images.push(safeName);
    db.prepare('UPDATE market_sessions SET images = ? WHERE date = ?')
      .run(JSON.stringify(images), req.params.date);
  } else {
    db.prepare('INSERT INTO market_sessions (date, images) VALUES (?, ?)')
      .run(req.params.date, JSON.stringify([safeName]));
  }

  res.json({ filename: safeName, url: `/uploads/${safeName}` });
});

// DELETE /api/sessions/:date/images/:filename
router.delete('/:date/images/:filename', (req, res) => {
  const { date, filename } = req.params;

  const filePath = path.join(getUploadsDir(), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const session = db.prepare('SELECT * FROM market_sessions WHERE date = ?').get(date);
  if (session) {
    const images = JSON.parse(session.images || '[]').filter(f => f !== filename);
    db.prepare('UPDATE market_sessions SET images = ? WHERE date = ?')
      .run(JSON.stringify(images), date);
  }

  res.json({ success: true });
});

module.exports = router;
