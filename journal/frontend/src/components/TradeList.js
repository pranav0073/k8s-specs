import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ImportModal from './ImportModal';

const LOT_SIZE   = 65;
const EMPTY_FILTERS = { instrument: '', strategy: '', status: '', from: '', to: '' };

// ── Leg pill (read-only display) ────────────────────────────────────────
function LegPill({ leg }) {
  const isBuy = leg.side === 'B';
  return (
    <span className={`leg-pill ${isBuy ? 'buy' : 'sell'}`}>
      <span className={`leg-dot ${isBuy ? 'buy' : 'sell'}`} />
      <span className="leg-strike">{leg.strike}</span>
      <span className="leg-otype">{leg.type}</span>
      <span className="leg-sep">·</span>
      <span className="leg-lots">{leg.lots}L</span>
      <span className="leg-expiry">{leg.expiry}</span>
    </span>
  );
}

function LegsSummary({ legs }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {legs.map((l, i) => <LegPill key={i} leg={l} />)}
    </div>
  );
}

// ── Inline edit panel ────────────────────────────────────────────────────
function EditPanel({ trade, onSave, onDelete, onCancel }) {
  const [data, setData] = useState({
    date:       trade.date,
    instrument: trade.instrument,
    strategy:   trade.strategy || '',
    status:     trade.status,
    close_date: trade.close_date || '',
    notes:      trade.notes || '',
    legs:       trade.legs.map(l => ({
      side:        l.side,
      strike:      l.strike,
      type:        l.type,
      expiry:      l.expiry,
      lots:        l.lots,
      entry_price: l.entry_price,
      exit_price:  l.exit_price ?? '',
    })),
  });

  const set   = (field, val) => setData(d => ({ ...d, [field]: val }));
  const setLeg = (idx, field, val) =>
    setData(d => ({ ...d, legs: d.legs.map((l, i) => i === idx ? { ...l, [field]: val } : l) }));
  const addLeg = () =>
    setData(d => ({ ...d, legs: [...d.legs, { side: 'B', strike: '', type: 'CE', expiry: '', lots: 1, entry_price: '', exit_price: '' }] }));
  const removeLeg = idx =>
    setData(d => ({ ...d, legs: d.legs.filter((_, i) => i !== idx) }));

  const handleSave = () => {
    const payload = {
      ...data,
      legs: data.legs.map(l => ({
        ...l,
        strike:      Number(l.strike),
        lots:        Number(l.lots),
        entry_price: Number(l.entry_price),
        exit_price:  l.exit_price !== '' && l.exit_price != null ? Number(l.exit_price) : null,
      })),
    };
    onSave(payload);
  };

  // preview P&L
  const previewPnl = data.status === 'closed'
    ? data.legs.reduce((sum, l) => {
        const ep = Number(l.exit_price);
        if (isNaN(ep) || l.exit_price === '') return sum;
        const mult = l.side === 'B' ? 1 : -1;
        return sum + (ep - Number(l.entry_price)) * LOT_SIZE * Number(l.lots) * mult;
      }, 0)
    : null;

  return (
    <div className="edit-panel" onClick={e => e.stopPropagation()}>
      {/* Basic fields */}
      <div className="edit-field">
        <label className="edit-label">Date</label>
        <input className="edit-input" type="date" value={data.date}
          onChange={e => set('date', e.target.value)} />
      </div>
      <div className="edit-field">
        <label className="edit-label">Instrument</label>
        <select className="edit-input" value={data.instrument}
          onChange={e => set('instrument', e.target.value)}>
          <option>NIFTY</option>
          <option>BANKNIFTY</option>
          <option>FINNIFTY</option>
          <option>MIDCPNIFTY</option>
        </select>
      </div>
      <div className="edit-field">
        <label className="edit-label">Strategy</label>
        <input className="edit-input" placeholder="e.g. Scalp, Swing…"
          value={data.strategy} onChange={e => set('strategy', e.target.value)} />
      </div>
      <div className="edit-field">
        <label className="edit-label">Status</label>
        <select className="edit-input" value={data.status}
          onChange={e => set('status', e.target.value)}>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>
      </div>
      <div className="edit-field">
        <label className="edit-label">Close Date</label>
        <input className="edit-input" type="date" value={data.close_date}
          onChange={e => set('close_date', e.target.value)} />
      </div>
      <div className="edit-field" style={{ gridColumn: 'span 2' }}>
        <label className="edit-label">Notes</label>
        <input className="edit-input" placeholder="Trade notes…"
          value={data.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* Legs */}
      <div className="edit-legs-section">
        <div className="edit-legs-label">Legs</div>
        <table className="edit-legs-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Strike</th>
              <th>Type</th>
              <th>Expiry</th>
              <th>Lots</th>
              <th>Entry ₹</th>
              <th>Exit ₹</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.legs.map((leg, i) => (
              <tr key={i} className={leg.side === 'B' ? 'buy-row' : 'sell-row'}>
                <td>
                  <select value={leg.side} onChange={e => setLeg(i, 'side', e.target.value)} style={{ width: 54 }}>
                    <option value="B">B</option>
                    <option value="S">S</option>
                  </select>
                </td>
                <td><input type="number" value={leg.strike} onChange={e => setLeg(i, 'strike', e.target.value)} style={{ width: 80 }} /></td>
                <td>
                  <select value={leg.type} onChange={e => setLeg(i, 'type', e.target.value)} style={{ width: 56 }}>
                    <option>CE</option>
                    <option>PE</option>
                  </select>
                </td>
                <td><input value={leg.expiry} onChange={e => setLeg(i, 'expiry', e.target.value)} style={{ width: 72 }} /></td>
                <td><input type="number" value={leg.lots} onChange={e => setLeg(i, 'lots', e.target.value)} style={{ width: 54 }} /></td>
                <td><input type="number" step="0.05" value={leg.entry_price} onChange={e => setLeg(i, 'entry_price', e.target.value)} style={{ width: 80 }} /></td>
                <td><input type="number" step="0.05" value={leg.exit_price} onChange={e => setLeg(i, 'exit_price', e.target.value)} placeholder="—" style={{ width: 80 }} /></td>
                <td>
                  <button className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--red)', padding: '2px 7px', fontSize: 15 }}
                    onClick={() => removeLeg(i)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost btn-sm" onClick={addLeg}>+ Add leg</button>
        {previewPnl != null && (
          <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 700,
            color: previewPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            P&L preview: {previewPnl >= 0 ? '+' : ''}₹{Math.round(previewPnl).toLocaleString('en-IN')}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="edit-actions">
        <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete trade</button>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleSave}>Save changes</button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────
export default function TradeList() {
  const [trades,      setTrades]      = useState([]);
  const [filters,     setFilters]     = useState(EMPTY_FILTERS);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState(null);
  const [showImport,  setShowImport]  = useState(false);
  const [importToast, setImportToast] = useState('');
  const navigate = useNavigate();

  const fetchTrades = useCallback(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    setLoading(true);
    axios.get('/api/trades', { params })
      .then(r => { setTrades(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters]);

  useEffect(() => { fetchTrades(); }, []); // eslint-disable-line

  const handleRowClick = (id) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleSave = async (id, payload) => {
    await axios.put(`/api/trades/${id}`, payload);
    setExpandedId(null);
    fetchTrades();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this trade?')) return;
    await axios.delete(`/api/trades/${id}`);
    setExpandedId(null);
    setTrades(p => p.filter(t => t.id !== id));
  };

  const handleImported = (count) => {
    fetchTrades();
    setImportToast(`${count} trade${count !== 1 ? 's' : ''} imported successfully.`);
    setTimeout(() => setImportToast(''), 4000);
  };

  const set = key => e => setFilters(f => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <div className="page-header">
        <h1>Trades</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowImport(true)}>Import CSV</button>
          <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>+ Add Trade</button>
        </div>
      </div>

      {importToast && <div className="import-toast">{importToast}</div>}

      <div className="filters">
        <select value={filters.instrument} onChange={set('instrument')}>
          <option value="">All Instruments</option>
          <option>NIFTY</option>
          <option>BANKNIFTY</option>
          <option>FINNIFTY</option>
          <option>MIDCPNIFTY</option>
        </select>
        <input placeholder="Strategy" value={filters.strategy} onChange={set('strategy')} style={{ width: 150 }} />
        <select value={filters.status} onChange={set('status')}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <input type="date" value={filters.from} onChange={set('from')} title="From date" />
        <input type="date" value={filters.to}   onChange={set('to')}   title="To date" />
        <button className="btn btn-primary" onClick={fetchTrades}>Apply</button>
        <button className="btn btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : trades.length === 0 ? (
        <div className="empty-state">
          <h2>No trades found</h2>
          <p>Add your first options trade or import from a broker CSV.</p>
        </div>
      ) : (
        <table className="trades-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Instrument</th>
              <th>Strategy</th>
              <th>Legs</th>
              <th style={{ textAlign: 'right' }}>Net Premium</th>
              <th style={{ textAlign: 'right' }}>P&amp;L</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => {
              const isExpanded = expandedId === t.id;
              const isDimmed   = expandedId != null && !isExpanded;
              return (
                <React.Fragment key={t.id}>
                  <tr
                    className={`data-row${isExpanded ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`}
                    onClick={() => handleRowClick(t.id)}
                  >
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 13 }}>{t.date}</td>
                    <td style={{ fontWeight: 700 }}>{t.instrument}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{t.strategy || '—'}</td>
                    <td><LegsSummary legs={t.legs} /></td>
                    <td style={{ textAlign: 'right', color: t.netPremium > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                      {t.netPremium === 0
                        ? '—'
                        : `${t.netPremium > 0 ? 'Pay' : 'Rcv'} ₹${Math.abs(t.netPremium).toLocaleString('en-IN')}`}
                    </td>
                    <td style={{ textAlign: 'right' }} className={t.pnl == null ? '' : t.pnl >= 0 ? 'pnl-green' : 'pnl-red'}>
                      {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}₹${Math.abs(t.pnl).toLocaleString('en-IN')}`}
                    </td>
                    <td><span className={`status-badge ${t.status}`}>{t.status}</span></td>
                  </tr>

                  {isExpanded && (
                    <tr className="edit-row">
                      <td colSpan={7}>
                        <EditPanel
                          trade={t}
                          onSave={payload => handleSave(t.id, payload)}
                          onDelete={() => handleDelete(t.id)}
                          onCancel={() => setExpandedId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
