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

// GET /api/sessions/analysis  — VIX / HV / ATR / range forecast / strategy suggestions
router.get('/analysis', async (req, res) => {
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
  const closes  = rows.map(r => r.close);
  const logRets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));

  function calcHV(n) {
    const r = logRets.slice(-n);
    if (r.length < 2) return null;
    const mean     = r.reduce((a, b) => a + b, 0) / r.length;
    const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    return Math.sqrt(variance * 252) * 100;
  }
  const hv10   = calcHV(10);
  const hv20   = calcHV(20);
  const hvUsed = hv10 ?? hv20;

  // ── Live India VIX from Yahoo Finance ──────────────────────────────────
  let vix = null, vixPrev = null, vixError = null;
  try {
    const vixRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?range=5d&interval=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    if (!vixRes.ok) throw new Error(`Yahoo VIX ${vixRes.status}`);
    const vixJson   = await vixRes.json();
    const vixCloses = vixJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid     = vixCloses.filter(v => v != null);
    vix     = valid.at(-1) ?? null;
    vixPrev = valid.at(-2) ?? null;
  } catch (e) {
    vixError = e.message;
  }

  const round1   = v => v != null ? Math.round(v * 10) / 10 : null;
  const round2   = v => v != null ? Math.round(v * 100) / 100 : null;
  const vixVal   = round1(vix);
  const vixChange    = (vix != null && vixPrev != null) ? round2(vix - vixPrev) : null;
  const vixChangePct = (vix != null && vixPrev != null) ? round2((vix - vixPrev) / vixPrev * 100) : null;

  // India VIX levels (calibrated for NSE, typically 10-80 range)
  const vixLevel = !vix ? null
    : vix >= 25 ? 'high'
    : vix >= 20 ? 'elevated'
    : vix >= 15 ? 'moderate'
    : 'low';

  // VIX vs HV ratio — >1.2 means options overpriced (sell); <0.8 means cheap (buy)
  const vixVsHv  = (vixVal && hvUsed) ? round2(vixVal / hvUsed) : null;
  const ivSignal = !vixVsHv ? 'neutral'
    : vixVsHv > 1.2 ? 'sell'
    : vixVsHv < 0.8 ? 'buy'
    : 'neutral';

  // ── Current close & weekly expected move ───────────────────────────────
  const currentClose = closes[closes.length - 1];
  const latestDate   = rows[rows.length - 1].date;

  // Prefer VIX for weekly EM (forward-looking); fall back to HV then ATR
  const volForMove = vixVal ?? hvUsed;
  const weeklyMove = volForMove
    ? currentClose * (volForMove / 100) * Math.sqrt(5 / 252)
    : (atr ? atr * Math.sqrt(5) : null);

  // ── Trend: 5-day price momentum ────────────────────────────────────────
  const trendWindow = closes.slice(-6);
  const trendPct    = trendWindow.length >= 2
    ? ((trendWindow.at(-1) - trendWindow[0]) / trendWindow[0]) * 100 : 0;
  const trend =
    trendPct >  1.5 ? 'strong_bullish' :
    trendPct >  0.4 ? 'bullish'        :
    trendPct < -1.5 ? 'strong_bearish' :
    trendPct < -0.4 ? 'bearish'        : 'sideways';

  // ── Weekly range projections (weeks 1-4) ───────────────────────────────
  const r50 = v => Math.round(v / 50) * 50;
  const weeklyRanges = weeklyMove ? [1, 2, 3, 4].map(w => {
    const move = weeklyMove * Math.sqrt(w);
    return { week: w, low: Math.round(currentClose - move), high: Math.round(currentClose + move), move: Math.round(move) };
  }) : [];

  // ── Strategy suggestions (VIX-primary, HV-fallback) ────────────────────
  // Primary regime: use VIX level when available, else map HV to same labels
  const hvLevel = !hvUsed ? 'unknown' : hvUsed > 20 ? 'high' : hvUsed < 12 ? 'low' : 'moderate';
  const regime  = vixLevel ?? (hvLevel === 'normal' ? 'moderate' : hvLevel);

  function suggest(name, fit, side, desc, strikes) {
    return { name, fit, side, description: desc, strikes };
  }

  const wm = weeklyMove;
  const cc = currentClose;
  let strategies = [];

  // ivSignal qualifier appended to description where relevant
  const ivNote = ivSignal === 'sell'
    ? ` VIX/HV = ${vixVsHv}× — options are overpriced vs history, favouring premium sellers.`
    : ivSignal === 'buy'
    ? ` VIX/HV = ${vixVsHv}× — options are cheap vs history, favouring premium buyers.`
    : '';

  if (regime === 'elevated' || regime === 'high') {
    if (trend === 'sideways') {
      strategies = [
        suggest('Iron Condor',    'high',   'sell',
          `Rich premium from ${vixVal ? `India VIX ${vixVal}` : 'high IV'} — sell a range with OTM CE & PE and buy further out for protection.${ivNote}`,
          wm ? `Sell ${r50(cc+wm*0.8)} CE / ${r50(cc-wm*0.8)} PE  •  Buy ${r50(cc+wm*1.3)} CE / ${r50(cc-wm*1.3)} PE` : null),
        suggest('Short Strangle', 'medium', 'sell',
          `High VIX inflates both sides — sell naked OTM CE and PE for maximum premium. Requires strict stop-loss discipline.${ivNote}`,
          wm ? `Sell ${r50(cc+wm)} CE / ${r50(cc-wm)} PE` : null),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Bull Call Spread',  'high',   'buy',
          `Bullish trend with elevated VIX — spread width captures most of the move while the short leg offsets expensive debit.${ivNote}`,
          wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm*0.9)} CE` : null),
        suggest('Short Put (CSP)',   'medium', 'sell',
          `Collect rich put premium with a bullish view. High VIX means the PE is expensive — obligation to buy NIFTY only if it falls.${ivNote}`,
          wm ? `Sell ${r50(cc-wm*0.7)} PE` : null),
      ];
    } else {
      strategies = [
        suggest('Bear Put Spread',   'high',   'buy',
          `Bearish trend with elevated VIX — spread offsets the expensive debit while capturing the downside move.${ivNote}`,
          wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm*0.9)} PE` : null),
        suggest('Short Call',        'medium', 'sell',
          `Sell OTM CE with bearish bias. High VIX makes the premium attractive — capped profit above the sold strike.${ivNote}`,
          wm ? `Sell ${r50(cc+wm*0.7)} CE` : null),
      ];
    }
  } else if (regime === 'low') {
    if (trend === 'sideways') {
      strategies = [
        suggest('Long Straddle',  'high',   'buy',
          `${vixVal ? `India VIX at ${vixVal} — options are cheap.` : 'Low IV — cheap options.'} Profit from a big move in either direction before expiry.${ivNote}`,
          wm ? `Buy ${r50(cc)} CE + ${r50(cc)} PE` : null),
        suggest('Long Strangle', 'medium', 'buy',
          `Lower cost than straddle. Buy OTM CE and PE — needs a bigger move but costs less.${ivNote}`,
          wm ? `Buy ${r50(cc+wm*0.5)} CE + ${r50(cc-wm*0.5)} PE` : null),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Long Call',        'high',   'buy',
          `${vixVal ? `VIX ${vixVal}` : 'Low IV'} = cheap calls. Ride the bullish trend with limited downside risk.${ivNote}`,
          wm ? `Buy ${r50(cc)} CE (ATM)` : null),
        suggest('Bull Call Spread', 'medium', 'buy',
          `Reduce cost by selling an OTM call. Still captures most of the upside while lowering the debit.${ivNote}`,
          wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm)} CE` : null),
      ];
    } else {
      strategies = [
        suggest('Long Put',        'high',   'buy',
          `${vixVal ? `VIX ${vixVal}` : 'Low IV'} = cheap puts. Ride the bearish trend with limited upside risk.${ivNote}`,
          wm ? `Buy ${r50(cc)} PE (ATM)` : null),
        suggest('Bear Put Spread', 'medium', 'buy',
          `Reduce cost by selling an OTM put. Captures most of the downside at lower premium outlay.${ivNote}`,
          wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm)} PE` : null),
      ];
    }
  } else {
    // moderate / unknown
    if (trend === 'sideways') {
      strategies = [
        suggest('Iron Condor',     'high',   'sell',
          `Balanced IV — classic range-bound play. Collect premium from both sides while NIFTY stays in range.${ivNote}`,
          wm ? `Sell ${r50(cc+wm*0.8)} CE / ${r50(cc-wm*0.8)} PE  •  Buy ${r50(cc+wm*1.4)} CE / ${r50(cc-wm*1.4)} PE` : null),
        suggest('Calendar Spread', 'medium', 'neutral',
          `Sell near-expiry ATM, buy next-expiry ATM. Profits from time decay while the spot stays flat.`,
          `ATM strike: ${r50(cc)}`),
      ];
    } else if (trend.includes('bullish')) {
      strategies = [
        suggest('Bull Call Spread',     'high',   'buy',
          `Defined-risk bullish play at moderate IV. Good premium efficiency for a trending market.${ivNote}`,
          wm ? `Buy ${r50(cc)} CE / Sell ${r50(cc+wm)} CE` : null),
        suggest('Iron Condor (skewed)', 'medium', 'sell',
          `Shift strikes higher — wider room on the upside for bullish drift while still collecting net credit.${ivNote}`,
          wm ? `Sell ${r50(cc+wm)} CE / ${r50(cc-wm*0.5)} PE  •  Buy ${r50(cc+wm*1.6)} CE / ${r50(cc-wm*1.1)} PE` : null),
      ];
    } else {
      strategies = [
        suggest('Bear Put Spread',      'high',   'buy',
          `Defined-risk bearish play at moderate IV. Good premium efficiency for a trending market.${ivNote}`,
          wm ? `Buy ${r50(cc)} PE / Sell ${r50(cc-wm)} PE` : null),
        suggest('Iron Condor (skewed)', 'medium', 'sell',
          `Shift strikes lower — wider room on the downside for bearish drift while collecting net credit.${ivNote}`,
          wm ? `Sell ${r50(cc-wm)} PE / ${r50(cc+wm*0.5)} CE  •  Buy ${r50(cc-wm*1.6)} PE / ${r50(cc+wm*1.1)} CE` : null),
      ];
    }
  }

  res.json({
    currentClose,
    latestDate,
    atr:           atr ? Math.round(atr) : null,
    hv10:          round1(hv10),
    hv20:          round1(hv20),
    hvUsed:        round1(hvUsed),
    hvLevel,
    vix:           vixVal,
    vixChange,
    vixChangePct,
    vixLevel,
    vixVsHv,
    ivSignal,
    vixError,
    weeklyMove:    weeklyMove ? Math.round(weeklyMove) : null,
    weeklyMoveSource: vixVal ? 'vix' : hvUsed ? 'hv' : 'atr',
    trend,
    trendPct:      Math.round(trendPct * 100) / 100,
    weeklyRanges,
    strategies,
    dataPoints:    rows.length,
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
