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
