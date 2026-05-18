import React, { useState } from 'react';
import axios from 'axios';

const LOT_SIZE = 65;

function calcLegPnl(leg) {
  if (!leg.closed || leg.exitPrice == null) return null;
  const mult = leg.side === 'B' ? 1 : -1;
  return Math.round((leg.exitPrice - leg.entryPrice) * LOT_SIZE * leg.lots * mult * 100) / 100;
}

export default function KiteImportModal({ onClose, onImported }) {
  const [step,     setStep]     = useState('fetch');
  const [legs,     setLegs]     = useState([]);
  const [date,     setDate]     = useState('');
  const [selected, setSelected] = useState({});
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const fetchTrades = async () => {
    setLoading(true); setError('');
    try {
      const r = await axios.get('/api/kite/fetch-trades');
      setDate(r.data.date);
      setLegs(r.data.legs || []);
      const sel = {};
      (r.data.legs || []).forEach((leg, i) => { sel[i] = !leg.alreadyImported; });
      setSelected(sel);
      setStep('preview');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to fetch trades from Kite');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setStep('importing');
    const toImport = legs.filter((_, i) => selected[i]);
    try {
      const r = await axios.post('/api/kite/import-kite-trades', { date, legs: toImport });
      onImported(r.data.imported);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Import failed');
      setStep('preview');
    }
  };

  const allSelected   = legs.length > 0 && legs.every((_, i) => selected[i]);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const toggleAll = (v) => {
    const sel = {};
    legs.forEach((leg, i) => { if (!leg.alreadyImported) sel[i] = v; else sel[i] = false; });
    setSelected(sel);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚡ Import from Zerodha Kite</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'fetch' && (
          <div className="import-upload-area">
            {error && <div className="import-error">{error}</div>}
            <p className="import-hint">
              Fetches <strong>today's</strong> executed NFO option trades directly from your Zerodha account.
              Weighted-average entry &amp; exit price is calculated per contract. Previously imported trades
              are detected and skipped automatically.
              For historical dates, use <strong>Import CSV</strong> instead.
            </p>
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <button className="btn btn-primary" onClick={fetchTrades} disabled={loading}>
                {loading ? 'Fetching…' : "Fetch Today's Trades"}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <>
            <p className="import-hint">
              Found <strong>{legs.length}</strong> contract{legs.length !== 1 ? 's' : ''} on{' '}
              <strong>{date}</strong>. Each contract will be created as a separate trade.
              {legs.some(l => l.alreadyImported) && (
                <span style={{ color: '#6b7280' }}> Rows marked "imported" were already added.</span>
              )}
            </p>

            {legs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>
                No NFO option trades found for today.
              </div>
            ) : (
              <>
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
                      {legs.map((leg, i) => {
                        const pnl = calcLegPnl(leg);
                        return (
                          <tr key={i} className={selected[i] ? '' : 'import-row-dimmed'}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!selected[i]}
                                disabled={leg.alreadyImported}
                                onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                              />
                            </td>
                            <td>
                              <strong>{leg.parsed.strike}{leg.parsed.optType}</strong>
                              <span className="import-expiry"> {leg.parsed.expiry}</span>
                              {leg.alreadyImported && (
                                <span style={{
                                  marginLeft: 6, fontSize: 10, background: '#e5e7eb',
                                  color: '#6b7280', borderRadius: 4, padding: '1px 5px',
                                }}>
                                  imported
                                </span>
                              )}
                            </td>
                            <td>
                              <span className={`leg-badge ${leg.side === 'B' ? 'buy' : 'sell'}`}>
                                {leg.side === 'B' ? 'BUY' : 'SELL'}
                              </span>
                            </td>
                            <td>{leg.lots}L</td>
                            <td>{leg.entryPrice != null ? `₹${leg.entryPrice.toFixed(2)}` : '—'}</td>
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
              </>
            )}

            {error && <div className="import-error" style={{ marginTop: 8 }}>{error}</div>}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              {legs.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={selectedCount === 0}
                >
                  Import {selectedCount} Trade{selectedCount !== 1 ? 's' : ''}
                </button>
              )}
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
