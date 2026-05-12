import React, { useState, useRef } from 'react';
import axios from 'axios';

const LOT_SIZE = 65;

// Zerodha weekly expiry: {INDEX}{YY}{M}{DD}{STRIKE}{CE|PE}
// M = 1-9 for Jan-Sep, O=Oct, N=Nov, D=Dec
const INSTRUMENT_RE = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY)(\d{2})([1-9ONDS])(\d{2})(\d+)(CE|PE)$/i;
const MONTH_CODES   = { '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9, O:10, N:11, D:12 };
const MONTH_NAMES   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseInstrumentName(name) {
  const m = INSTRUMENT_RE.exec(name.toUpperCase());
  if (!m) return null;
  const [, index, yy, monCode, dd, strikeStr, optType] = m;
  const mon = MONTH_CODES[monCode.toUpperCase()];
  if (!mon) return null;
  return {
    index,
    expiry:  `${parseInt(dd, 10)} ${MONTH_NAMES[mon - 1]}`,
    strike:  parseInt(strikeStr, 10),
    optType,
  };
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

function processCSV(text) {
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

  // Sort ascending by time so "first order" = opening side
  rawRows.sort((a, b) => a.time.localeCompare(b.time));

  const tradeDate = rawRows[0].time.slice(0, 10);

  // Group by instrument, track opening side from first order
  const byInstrument = {};
  for (const row of rawRows) {
    if (!byInstrument[row.instrument]) {
      byInstrument[row.instrument] = { buys: [], sells: [], openingSide: row.type };
    }
    if (row.type === 'BUY') {
      byInstrument[row.instrument].buys.push({ qty: row.qty, price: row.price });
    } else {
      byInstrument[row.instrument].sells.push({ qty: row.qty, price: row.price });
    }
  }

  const legs = [];
  for (const [instrumentName, { buys, sells, openingSide }] of Object.entries(byInstrument)) {
    const parsed = parseInstrumentName(instrumentName);
    if (!parsed) continue;

    const totalBuyQty  = buys.reduce((s, x)  => s + x.qty,           0);
    const totalSellQty = sells.reduce((s, x) => s + x.qty,           0);
    const buyAvg       = totalBuyQty  > 0 ? buys.reduce((s, x)  => s + x.qty * x.price, 0) / totalBuyQty  : null;
    const sellAvg      = totalSellQty > 0 ? sells.reduce((s, x) => s + x.qty * x.price, 0) / totalSellQty : null;

    const side       = openingSide === 'BUY' ? 'B' : 'S';
    const totalQty   = Math.max(totalBuyQty, totalSellQty);
    const lots       = Math.round(totalQty / LOT_SIZE);
    const closed     = totalBuyQty === totalSellQty;
    const entryPrice = side === 'B' ? buyAvg  : sellAvg;
    const exitPrice  = closed       ? (side === 'B' ? sellAvg : buyAvg) : null;

    legs.push({
      instrumentName,
      parsed,
      side,
      lots,
      entryPrice: Math.round(entryPrice * 100) / 100,
      exitPrice:  exitPrice != null ? Math.round(exitPrice * 100) / 100 : null,
      closed,
      totalBuyQty,
      totalSellQty,
    });
  }

  return legs.length > 0 ? { tradeDate, legs } : null;
}

function calcLegPnl(leg) {
  if (!leg.closed || leg.exitPrice == null) return null;
  const mult = leg.side === 'B' ? 1 : -1;
  return Math.round((leg.exitPrice - leg.entryPrice) * LOT_SIZE * leg.lots * mult * 100) / 100;
}

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
        const result = processCSV(e.target.result);
        if (!result) {
          setError('No valid COMPLETE orders found. Make sure this is a Zerodha order book CSV export.');
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
    const { tradeDate, legs } = parsed;
    const toImport = legs.filter((_, i) => selected[i]);
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
      try {
        await axios.post('/api/trades', {
          date:       tradeDate,
          instrument: leg.parsed.index,
          legs:       [tradeLeg],
          status:     leg.closed ? 'closed' : 'open',
          close_date: leg.closed ? tradeDate : null,
          notes:      `Imported: ${leg.totalBuyQty} qty bought @ avg ₹${leg.side === 'B' ? leg.entryPrice : leg.exitPrice ?? '—'}, ${leg.totalSellQty} qty sold @ avg ₹${leg.side === 'S' ? leg.entryPrice : leg.exitPrice ?? '—'}`,
        });
        count++;
      } catch (e) {
        console.error('Failed to import', leg.instrumentName, e);
      }
    }
    onImported(count);
    onClose();
  };

  const allSelected     = parsed?.legs.length > 0 && parsed.legs.every((_, i) => selected[i]);
  const selectedCount   = Object.values(selected).filter(Boolean).length;
  const toggleAll = (v) => {
    const sel = {};
    parsed?.legs.forEach((_, i) => { sel[i] = v; });
    setSelected(sel);
  };

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
              Upload a Zerodha order book CSV. Only <strong>COMPLETE</strong> orders are used.
              Weighted average entry &amp; exit price is calculated per contract.
            </p>
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
              Found <strong>{parsed.legs.length}</strong> contract{parsed.legs.length !== 1 ? 's' : ''} on{' '}
              <strong>{parsed.tradeDate}</strong>. Each contract will be created as a separate trade.
            </p>
            <div className="import-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={e => toggleAll(e.target.checked)}
                />
                {' '}Select all
              </label>
            </div>
            <div className="import-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Contract</th>
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
                        <td>
                          <span className={`leg-badge ${leg.side === 'B' ? 'buy' : 'sell'}`}>
                            {leg.side === 'B' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td>{leg.lots}L</td>
                        <td>₹{leg.entryPrice.toFixed(2)}</td>
                        <td>{leg.exitPrice != null ? `₹${leg.exitPrice.toFixed(2)}` : '—'}</td>
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
