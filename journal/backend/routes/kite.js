const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');

const KITE_BASE  = 'https://api.kite.trade';
const KITE_LOGIN = 'https://kite.zerodha.com/connect/login';

const MONTH_MAP  = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const MONTH_3    = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_CODE = ['1','2','3','4','5','6','7','8','9','O','N','D'];

function lastTuesdayOfMonth(year, mon) {
  const last = new Date(year, mon + 1, 0);
  const sub  = (last.getDay() - 2 + 7) % 7;
  return new Date(year, mon, last.getDate() - sub);
}

function getConfig() {
  return db.prepare('SELECT * FROM kite_config WHERE id = 1').get() || {};
}

// Build Kite tradingsymbol from stored leg
// "May '26" → NIFTY26MAY23600CE  (monthly: last Tuesday)
// "19 May"  → NIFTY26519{strike}{type}  (weekly: YY + month_code + DD)
function buildSymbol(leg) {
  const { strike, type, expiry } = leg;
  if (!expiry || !strike || !type) return null;

  const monthly = expiry.match(/^([A-Za-z]{3})\s*'(\d{2})$/);
  if (monthly) {
    const mon  = MONTH_MAP[monthly[1].toLowerCase()];
    const year = 2000 + parseInt(monthly[2], 10);
    const d    = lastTuesdayOfMonth(year, mon);
    return `NIFTY${String(d.getDate()).padStart(2,'0')}${MONTH_3[mon]}${strike}${type}`;
  }

  const weekly = expiry.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (weekly) {
    const day = parseInt(weekly[1], 10);
    const mon = MONTH_MAP[weekly[2].toLowerCase()];
    const now = new Date();
    let d = new Date(now.getFullYear(), mon, day);
    if (d < now) d = new Date(now.getFullYear() + 1, mon, day);
    const year = d.getFullYear();
    const yy   = String(year).slice(2);
    // If this date is the last Tuesday of the month → monthly NIFTY contract
    if (lastTuesdayOfMonth(year, mon).getDate() === day) {
      return `NIFTY${yy}${MONTH_3[mon]}${strike}${type}`;
    }
    const mc = MONTH_CODE[mon];
    const dd = String(day).padStart(2, '0');
    return `NIFTY${yy}${mc}${dd}${strike}${type}`;
  }
  return null;
}

// GET /api/kite/status
router.get('/status', (req, res) => {
  const cfg   = getConfig();
  const today = new Date().toISOString().split('T')[0];
  res.json({
    configured:    !!(cfg.api_key && cfg.api_secret),
    authenticated: !!(cfg.access_token && cfg.token_date === today),
    token_date:    cfg.token_date || null,
    api_key_hint:  cfg.api_key ? cfg.api_key.slice(0, 6) + '****' : null,
  });
});

// POST /api/kite/configure  — save API key + secret
router.post('/configure', (req, res) => {
  const { api_key, api_secret } = req.body;
  if (!api_key || !api_secret) return res.status(400).json({ error: 'api_key and api_secret required' });
  db.prepare(
    'UPDATE kite_config SET api_key = ?, api_secret = ?, access_token = NULL, token_date = NULL WHERE id = 1'
  ).run(api_key.trim(), api_secret.trim());
  res.json({ ok: true });
});

// GET /api/kite/login-url  — returns Zerodha OAuth URL
router.get('/login-url', (req, res) => {
  const cfg = getConfig();
  if (!cfg.api_key) return res.status(400).json({ error: 'API key not configured' });
  res.json({ url: `${KITE_LOGIN}?v=3&api_key=${cfg.api_key}` });
});

// GET /api/kite/callback  — Zerodha redirects here after login
router.get('/callback', async (req, res) => {
  const { request_token, status } = req.query;
  if (status !== 'success' || !request_token) {
    return res.status(400).send(html('Kite login failed or cancelled.', '#dc2626'));
  }
  const cfg = getConfig();
  if (!cfg.api_key || !cfg.api_secret) {
    return res.status(400).send(html('API key/secret not configured.', '#dc2626'));
  }
  try {
    const checksum = crypto.createHash('sha256')
      .update(cfg.api_key + request_token + cfg.api_secret)
      .digest('hex');
    const r = await fetch(`${KITE_BASE}/session/token`, {
      method:  'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ api_key: cfg.api_key, request_token, checksum }),
    });
    const data = await r.json();
    if (!r.ok || !data.data?.access_token) throw new Error(data.message || 'Token exchange failed');
    const today = new Date().toISOString().split('T')[0];
    db.prepare('UPDATE kite_config SET access_token = ?, token_date = ? WHERE id = 1')
      .run(data.data.access_token, today);
    res.send(html('✓ Zerodha connected! You can close this tab.', '#16a34a', true));
  } catch (err) {
    res.status(502).send(html('Auth failed: ' + err.message, '#dc2626'));
  }
});

function html(msg, color, notify = false) {
  return `<html><body style="font-family:sans-serif;padding:2rem;text-align:center">
    <h2 style="color:${color}">${msg}</h2>
    ${notify ? `<script>window.opener?.postMessage('kite_auth_success','*');setTimeout(()=>window.close(),1500)</script>` : ''}
  </body></html>`;
}

// GET /api/kite/quotes?trade_id=83  — live LTP + Greeks for all legs of a trade
router.get('/quotes', async (req, res) => {
  try {
    const { trade_id } = req.query;
    const cfg   = getConfig();
    const today = new Date().toISOString().split('T')[0];

    if (!cfg.access_token || cfg.token_date !== today) {
      return res.status(401).json({ error: 'Kite not authenticated for today. Please reconnect.' });
    }

    const trade = trade_id ? db.prepare('SELECT * FROM trades WHERE id = ?').get(trade_id) : null;
    if (trade_id && !trade) return res.status(404).json({ error: 'Trade not found' });

    const legs = trade
      ? JSON.parse(trade.legs || '[]')
      : db.prepare("SELECT legs FROM trades WHERE status = 'open'").all()
          .flatMap(t => JSON.parse(t.legs || '[]'));

    const symbols = [...new Set(legs.map(l => buildSymbol(l)).filter(Boolean))];
    if (!symbols.length) return res.json({ quotes: {}, legQuotes: [] });

    const qs = symbols.map(s => `i=NFO:${s}`).join('&');
    const r  = await fetch(`${KITE_BASE}/quote?${qs}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${cfg.api_key}:${cfg.access_token}` },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Kite API error' });

    const quotes = {};
    for (const [k, v] of Object.entries(data.data || {})) {
      quotes[k.replace(/^NFO:/, '')] = {
        ltp:    v.last_price,
        change: v.net_change,
        delta:  v.greeks?.delta  ?? null,
        theta:  v.greeks?.theta  ?? null,
        gamma:  v.greeks?.gamma  ?? null,
        vega:   v.greeks?.vega   ?? null,
        iv:     v.greeks?.iv     ?? null,
        oi:     v.oi             ?? null,
      };
    }

    const legQuotes = legs.map(l => {
      const sym = buildSymbol(l);
      return { ...l, symbol: sym, quote: sym ? (quotes[sym] ?? null) : null };
    });

    res.json({ quotes, legQuotes });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
