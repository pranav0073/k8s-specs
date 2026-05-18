import React, { useState, useRef } from 'react';
import axios from 'axios';

const LOT_SIZE = 65;

// ── Zerodha symbol regexes ────────────────────────────────────────────────────
const WEEKLY_RE  = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY)(\d{2})([1-9ONDS])(\d{2})(\d+)(CE|PE)$/i;
const MONTHLY_RE = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)(CE|PE)$/i;
const MONTH_CODES = { '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9, O:10, N:11, D:12 };
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function lastTuesdayOfMonth(year, mon) {
  const last = new Date(year, mon + 1, 0);
  const sub  = (last.getDay() - 2 + 7) % 7;
  return new Date(year, mon, last.getDate() - sub);
}

function expiryFromDate(dateStr) {
  // dateStr: "YYYY-MM-DD" → "12 May" or "May '26"
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const mon = m - 1; // 0-indexed
  const lastTues = lastTuesdayOfMonth(y, mon);
  if (lastTues.getDate() === d) return `${MONTH_NAMES[mon]} '${String(y).slice(2)}`;
  return `${d} ${MONTH_NAMES[mon]}`;
}

function parseInstrumentName(name) {
  const upper = name.toUpperCase();
  const w = WEEKLY_RE.exec(upper);
  if (w) {
    const [, index, , monCode, dd, strikeStr, optType] = w;
    const mon = MONTH_CODES[monCode.toUpperCase()];
    if (!mon) return null;
    return { index, expiry: `${parseInt(dd, 10)} ${MONTH_NAMES[mon - 1]}`, strike: parseInt(strikeStr, 10), optType };
  }
  const mo = MONTHLY_RE.exec(upper);
  if (mo) {
    const [, index, yy, monStr, strikeStr, optType] = mo;
    const monIdx = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(monStr.toUpperCase());
    if (monIdx === -1) return null;
    return { index, expiry: `${MONTH_NAMES[monIdx]} '${yy}`, strike: parseInt(strikeStr, 10), optType };
  }
  return null;
}

function parseCSVLine(line) {
  const cols = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      cols.push(line.slice(i + 1, j));
      i = j + 2;
    } else {
      let j = i;
      while (j < line.length && line[j] !== ',') j++;
      cols.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return cols;
}

// ── Format detection ──────────────────────────────────────────────────────────
function detectFormat(header) {
  if (/^symbol,isin,trade_date/i.test(header)) return 'tradebook';
  return 'orderbook';
}

// ── Tradebook parser (Console → Reports → Tradebook) ─────────────────────────
// Columns: symbol,isin,trade_date,exchange,segment,series,trade_type,auction,
//          quantity,price,trade_id,order_id,order_execution_time,expiry_date
function processTradebook(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rawRows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 10) continue;
    const symbol      = cols[0]?.trim().toUpperCase();
    const trade_date  = cols[2]?.trim();
    const segment     = cols[4]?.trim().toUpperCase();
    const trade_type  = cols[6]?.trim().toUpperCase(); // 'buy'/'sell' → 'BUY'/'SELL'
    const qty         = Math.round(parseFloat(cols[8]));
    const price       = parseFloat(cols[9]);
    const trade_id    = cols[10]?.trim();
    const expiry_date = cols[13]?.trim();

    if (segment !== 'FO') continue;
    if (!symbol || isNaN(qty) || isNaN(price) || qty <= 0) continue;
    rawRows.push({ symbol, trade_date, trade_type, qty, price, trade_id, expiry_date });
  }

  if (rawRows.length === 0) return null;

  // Group by symbol (across all dates) — treat as single trade per contract
  // Use first execution date as entry date, last as close date
  const bySymbol = {};
  for (const row of rawRows) {
    if (!bySymbol[row.symbol]) {
      bySymbol[row.symbol] = {
        buys: [], sells: [], tradeIds: [],
        firstDate: row.trade_date, lastDate: row.trade_date,
        firstType: row.trade_type, expiry_date: row.expiry_date,
      };
    }
    const g = bySymbol[row.symbol];
    g.tradeIds.push(row.trade_id);
    if (row.trade_date < g.firstDate) { g.firstDate = row.trade_date; g.firstType = row.trade_type; }
    if (row.trade_date > g.lastDate)    g.lastDate = row.trade_date;
    if (row.trade_type === 'BUY') g.buys.push({ qty: row.qty, price: row.price });
    else                          g.sells.push({ qty: row.qty, price: row.price });
  }

  const legs = [];
  for (const [sym, g] of Object.entries(bySymbol)) {
    const parsed = parseInstrumentName(sym);
    if (!parsed) continue;

    // Use expiry_date from CSV for accurate expiry string
    if (g.expiry_date) {
      const fromDate = expiryFromDate(g.expiry_date);
      if (fromDate) parsed.expiry = fromDate;
    }

    const totalBuyQty  = g.buys.reduce((s, x) => s + x.qty, 0);
    const totalSellQty = g.sells.reduce((s, x) => s + x.qty, 0);
    const buyAvg  = totalBuyQty  > 0 ? g.buys.reduce((s, x) => s + x.qty * x.price, 0) / totalBuyQty  : null;
    const sellAvg = totalSellQty > 0 ? g.sells.reduce((s, x) => s + x.qty * x.price, 0) / totalSellQty : null;

    const side       = g.firstType === 'BUY' ? 'B' : 'S';
    const totalQty   = Math.max(totalBuyQty, totalSellQty);
    const lots       = Math.round(totalQty / LOT_SIZE);
    const closed     = totalBuyQty === totalSellQty;
    const entryPrice = side === 'B' ? buyAvg : sellAvg;
    const exitPrice  = closed ? (side === 'B' ? sellAvg : buyAvg) : null;

    legs.push({
      tradeDate:  g.firstDate,
      closeDate:  closed && g.lastDate !== g.firstDate ? g.lastDate : (closed ? g.firstDate : null),
      instrumentName: sym,
      parsed,
      side,
      lots,
      entryPrice: entryPrice != null ? Math.round(entryPrice * 100) / 100 : null,
      exitPrice:  exitPrice  != null ? Math.round(exitPrice  * 100) / 100 : null,
      closed,
      totalBuyQty,
      totalSellQty,
      tradeIds: g.tradeIds,
    });
  }

  if (legs.length === 0) return null;

  // Determine date range label
  const allDates = [...new Set(legs.map(l => l.tradeDate))].sort();
  const dateLabel = allDates.length === 1 ? allDates[0] : `${allDates[0]} → ${allDates[allDates.length - 1]}`;

  return { legs, tradeDate: allDates[0], dateLabel, format: 'tradebook' };
}

// ── Order Book parser (existing format) ──────────────────────────────────────
// Columns: time, type, instrument, ?, qty, price, status
function processOrderbook(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rawRows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 7) continue;
    const [time, type, instrument, , qtyStr, priceStr, status] = cols;
    if (status !== 'COMPLETE') continue;
    const qty   = parseInt((qtyStr || '').split('/')[0], 10);
    const price = parseFloat(priceStr);
    if (!instrument || isNaN(qty) || isNaN(price) || qty <= 0) continue;
    rawRows.push({ time, type: type.toUpperCase(), instrument: instrument.toUpperCase(), qty, price });
  }

  if (rawRows.length === 0) return null;
  rawRows.sort((a, b) => a.time.localeCompare(b.time));
  const tradeDate = rawRows[0].time.slice(0, 10);

  const byInstrument = {};
  for (const row of rawRows) {
    if (!byInstrument[row.instrument]) {
      byInstrument[row.instrument] = { buys: [], sells: [], openingSide: row.type };
    }
    if (row.type === 'BUY') byInstrument[row.instrument].buys.push({ qty: row.qty, price: row.price });
    else                    byInstrument[row.instrument].sells.push({ qty: row.qty, price: row.price });
  }

  const legs = [];
  for (const [instrumentName, { buys, sells, openingSide }] of Object.entries(byInstrument)) {
    const parsed = parseInstrumentName(instrumentName);
    if (!parsed) continue;

    const totalBuyQty  = buys.reduce((s, x)  => s + x.qty, 0);
    const totalSellQty = sells.reduce((s, x) => s + x.qty, 0);
    const buyAvg       = totalBuyQty  > 0 ? buys.reduce((s, x)  => s + x.qty * x.price, 0) / totalBuyQty  : null;
    const sellAvg      = totalSellQty > 0 ? sells.reduce((s, x) => s + x.qty * x.price, 0) / totalSellQty : null;

    const side       = openingSide === 'BUY' ? 'B' : 'S';
    const totalQty   = Math.max(totalBuyQty, totalSellQty);
    const lots       = Math.round(totalQty / LOT_SIZE);
    const closed     = totalBuyQty === totalSellQty;
    const entryPrice = side === 'B' ? buyAvg  : sellAvg;
    const exitPrice  = closed       ? (side === 'B' ? sellAvg : buyAvg) : null;

    legs.push({
      tradeDate,
      closeDate: closed ? tradeDate : null,
      instrumentName,
      parsed,
      side,
      lots,
      entryPrice: Math.round(entryPrice * 100) / 100,
      exitPrice:  exitPrice != null ? Math.round(exitPrice * 100) / 100 : null,
      closed,
      totalBuyQty,
      totalSellQty,
      tradeIds: [],
    });
  }

  return legs.length > 0 ? { legs, tradeDate, dateLabel: tradeDate, format: 'orderbook' } : null;
}

function calcLegPnl(leg) {
  if (!leg.closed || leg.exitPrice == null || leg.entryPrice == null) return null;
  const mult = leg.side === 'B' ? 1 : -1;
  return Math.round((leg.exitPrice - leg.entryPrice) * LOT_SIZE * leg.lots * mult * 100) / 100;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ImportModal({ onClose, onImported }) {
  const [step,     setStep]     = useState('upload');
  const [parsed,   setParsed]   = useState(null);
  const [selected, setSelected] = useState({});
  const [error,    setError]    = useState('');
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text   = e.target.result;
        const header = text.split('\n')[0].trim();
        const fmt    = detectFormat(header);
        const result = fmt === 'tradebook' ? processTradebook(text) : processOrderbook(text);
        if (!result) {
          setError(
            fmt === 'tradebook'
              ? 'No valid FO trades found. Make sure this is a Zerodha Tradebook CSV (Console → Reports → Tradebook).'
              : 'No valid COMPLETE orders found. Make sure this is a Zerodha Order Book CSV export.'
          );
          return;
        }
        setParsed(result);
        const sel = {};
        result.legs.forEach((_, i) => { sel[i] = true; });
        setSelected(sel);
        setStep('preview');
      } catch (err) {
        setError('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setStep('importing');
    const toImport = parsed.legs.filter((_, i) => selected[i]);
    let count = 0;
    for (const leg of toImport) {
      const tradeLeg = {
        side:        leg.side,
        lots:        leg.lots,
        strike:      leg.parsed.strike,
        type:        leg.parsed.optType,
        expiry:      leg.parsed.expiry,
        entry_price: leg.entryPrice,
        exit_price:  leg.exitPrice,
      };
      const entryAvg = leg.side === 'B' ? leg.entryPrice : (leg.exitPrice ?? '—');
      const exitAvg  = leg.side === 'S' ? leg.entryPrice : (leg.exitPrice ?? '—');
      try {
        await axios.post('/api/trades', {
          date:           leg.tradeDate,
          instrument:     leg.parsed.index,
          legs:           [tradeLeg],
          status:         leg.closed ? 'closed' : 'open',
          close_date:     leg.closeDate || null,
          notes:          `Imported: ${leg.totalBuyQty} qty bought @ avg ₹${entryAvg}, ${leg.totalSellQty} qty sold @ avg ₹${exitAvg}`,
          kite_trade_ids: leg.tradeIds.length > 0 ? leg.tradeIds.join(',') : null,
        });
        count++;
      } catch (e) {
        console.error('Failed to import', leg.instrumentName, e);
      }
    }
    onImported(count);
    onClose();
  };

  const allSelected   = parsed?.legs.length > 0 && parsed.legs.every((_, i) => selected[i]);
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const toggleAll = (v) => {
    const sel = {};
    parsed?.legs.forEach((_, i) => { sel[i] = v; });
    setSelected(sel);
  };

  const isTradebook = parsed?.format === 'tradebook';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Orders CSV</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'upload' && (
          <div className="import-upload-area">
            {error && <div className="import-error">{error}</div>}
            <p className="import-hint">
              Supports two Zerodha CSV formats:
            </p>
            <ul className="import-hint" style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li><strong>Tradebook</strong> — Console → Reports → Tradebook (multi-day, recommended)</li>
              <li><strong>Order Book</strong> — single-day order history export</li>
            </ul>
            <div
              className="img-drop-zone"
              style={{ padding: '24px 16px', fontSize: 13 }}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
              <span>Drop CSV file here or <u>click to browse</u></span>
            </div>
          </div>
        )}

        {step === 'preview' && parsed && (
          <>
            <p className="import-hint">
              {isTradebook ? (
                <>
                  <strong>Tradebook</strong> — found <strong>{parsed.legs.length}</strong> contract{parsed.legs.length !== 1 ? 's' : ''} across{' '}
                  <strong>{parsed.dateLabel}</strong>. Each contract becomes a separate trade.
                </>
              ) : (
                <>
                  Found <strong>{parsed.legs.length}</strong> contract{parsed.legs.length !== 1 ? 's' : ''} on{' '}
                  <strong>{parsed.dateLabel}</strong>. Each contract will be created as a separate trade.
                </>
              )}
            </p>
            <div className="import-select-all">
              <label>
                <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} />
                {' '}Select all
              </label>
            </div>
            <div className="import-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Contract</th>
                    <th>Date</th>
                    <th>Side</th>
                    <th>Lots</th>
                    <th>Avg Entry</th>
                    <th>Avg Exit</th>
                    <th>P&amp;L</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.legs.map((leg, i) => {
                    const pnl = calcLegPnl(leg);
                    return (
                      <tr key={i} className={selected[i] ? '' : 'import-row-dimmed'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selected[i]}
                            onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                          />
                        </td>
                        <td>
                          <strong>{leg.parsed.strike}{leg.parsed.optType}</strong>
                          <span className="import-expiry"> {leg.parsed.expiry}</span>
                        </td>
                        <td style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
                          {leg.tradeDate}
                          {leg.closeDate && leg.closeDate !== leg.tradeDate && (
                            <span> → {leg.closeDate}</span>
                          )}
                        </td>
                        <td>
                          <span className={`leg-badge ${leg.side === 'B' ? 'buy' : 'sell'}`}>
                            {leg.side === 'B' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td>{leg.lots}L</td>
                        <td>{leg.entryPrice != null ? `₹${leg.entryPrice.toFixed(2)}` : '—'}</td>
                        <td>{leg.exitPrice  != null ? `₹${leg.exitPrice.toFixed(2)}`  : '—'}</td>
                        <td className={pnl == null ? '' : pnl >= 0 ? 'pnl-green' : 'pnl-red'}>
                          {pnl != null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(0)}` : '—'}
                        </td>
                        <td>
                          <span className={`status-badge ${leg.closed ? 'closed' : 'open'}`}>
                            {leg.closed ? 'closed' : 'open'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={selectedCount === 0}
              >
                Import {selectedCount} Trade{selectedCount !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="loading">Importing trades…</div>
        )}
      </div>
    </div>
  );
}
