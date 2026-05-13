import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import ImportModal from './ImportModal';

const LOT_SIZE = 65;
const EMPTY_FILTERS = { instrument: '', strategy: '', status: 'open', from: '', to: '' };
const STRATEGIES = [
  'Calendar Spread', 'Bull Put Spread', 'Bear Call Spread',
  'Iron Condor', 'Straddle', 'Strangle', 'Butterfly',
  'Ratio Spread', 'Jade Lizard', 'Naked',
];

// ── Leg pill (read-only) ─────────────────────────────────────────────────
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
    legs: trade.legs.map(l => ({
      side:        l.side,
      strike:      l.strike,
      type:        l.type,
      expiry:      l.expiry,
      lots:        l.lots,
      entry_price: l.entry_price,
      exit_price:  l.exit_price ?? '',
    })),
  });

  const set    = (field, val) => setData(d => ({ ...d, [field]: val }));
  const setLeg = (idx, field, val) =>
    setData(d => ({ ...d, legs: d.legs.map((l, i) => i === idx ? { ...l, [field]: val } : l) }));
  const addLeg = () =>
    setData(d => ({ ...d, legs: [...d.legs, { side: 'B', strike: '', type: 'CE', expiry: '', lots: 1, entry_price: '', exit_price: '' }] }));
  const removeLeg = idx =>
    setData(d => ({ ...d, legs: d.legs.filter((_, i) => i !== idx) }));

  const handleSave = () => {
    onSave({
      ...data,
      legs: data.legs.map(l => ({
        ...l,
        strike:      Number(l.strike),
        lots:        Number(l.lots),
        entry_price: Number(l.entry_price),
        exit_price:  l.exit_price !== '' && l.exit_price != null ? Number(l.exit_price) : null,
      })),
    });
  };

  const previewPnl = data.status === 'closed'
    ? data.legs.reduce((sum, l) => {
        const ep = Number(l.exit_price);
        if (isNaN(ep) || l.exit_price === '') return sum;
        return sum + (ep - Number(l.entry_price)) * LOT_SIZE * Number(l.lots) * (l.side === 'B' ? 1 : -1);
      }, 0)
    : null;

  return (
    <div className="edit-panel" onClick={e => e.stopPropagation()}>

      {/* ── Header row ── */}
      <div className="ep-header">
        <span className="ep-title">Edit Trade</span>
        <Link to={`/trades/${trade.id}`} className="ep-detail-link">
          Open full detail →
        </Link>
      </div>

      {/* ── Fields grid ── */}
      <div className="ep-fields">
        <div className="ep-field">
          <label>Date</label>
          <input type="date" value={data.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div className="ep-field">
          <label>Instrument</label>
          <select value={data.instrument} onChange={e => set('instrument', e.target.value)}>
            <option>NIFTY</option><option>BANKNIFTY</option>
            <option>FINNIFTY</option><option>MIDCPNIFTY</option>
          </select>
        </div>
        <div className="ep-field ep-field-wide">
          <label>Strategy</label>
          <input list="ep-strat-list" value={data.strategy}
            onChange={e => set('strategy', e.target.value)} placeholder="Select or type…" />
          <datalist id="ep-strat-list">
            {STRATEGIES.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="ep-field">
          <label>Status</label>
          <select value={data.status} onChange={e => set('status', e.target.value)}>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <div className="ep-field">
          <label>Close Date</label>
          <input type="date" value={data.close_date} onChange={e => set('close_date', e.target.value)} />
        </div>
        <div className="ep-field ep-field-full">
          <label>Notes</label>
          <input value={data.notes} onChange={e => set('notes', e.target.value)} placeholder="Trade notes…" />
        </div>
      </div>

      {/* ── Legs ── */}
      <div className="ep-legs-section">
        <div className="ep-section-label">Legs</div>
        <table className="ep-legs-table">
          <thead>
            <tr>
              <th>Side</th><th>Strike</th><th>Type</th>
              <th>Expiry</th><th>Lots</th><th>Entry ₹</th><th>Exit ₹</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.legs.map((leg, i) => (
              <tr key={i} className={leg.side === 'B' ? 'buy-row' : 'sell-row'}>
                <td>
                  <select value={leg.side} onChange={e => setLeg(i, 'side', e.target.value)} style={{ width: 52 }}>
                    <option value="B">B</option><option value="S">S</option>
                  </select>
                </td>
                <td><input type="number" value={leg.strike} onChange={e => setLeg(i, 'strike', e.target.value)} style={{ width: 78 }} /></td>
                <td>
                  <select value={leg.type} onChange={e => setLeg(i, 'type', e.target.value)} style={{ width: 54 }}>
                    <option>CE</option><option>PE</option>
                  </select>
                </td>
                <td><input value={leg.expiry} onChange={e => setLeg(i, 'expiry', e.target.value)} style={{ width: 68 }} /></td>
                <td><input type="number" value={leg.lots} onChange={e => setLeg(i, 'lots', e.target.value)} style={{ width: 50 }} /></td>
                <td><input type="number" step="0.05" value={leg.entry_price} onChange={e => setLeg(i, 'entry_price', e.target.value)} style={{ width: 76 }} /></td>
                <td><input type="number" step="0.05" value={leg.exit_price} onChange={e => setLeg(i, 'exit_price', e.target.value)} placeholder="—" style={{ width: 76 }} /></td>
                <td>
                  <button className="ep-remove-leg" onClick={() => removeLeg(i)} title="Remove leg">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ep-legs-footer">
          <button className="btn btn-ghost btn-sm" onClick={addLeg}>+ Add leg</button>
          {previewPnl != null && (
            <span className={`ep-pnl-preview ${previewPnl >= 0 ? 'pos' : 'neg'}`}>
              P&L: {previewPnl >= 0 ? '+' : ''}₹{Math.round(previewPnl).toLocaleString('en-IN')}
            </span>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="ep-actions">
        <button className="btn btn-sm ep-delete" onClick={onDelete}>Delete trade</button>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm ep-save" onClick={handleSave}>Save changes</button>
      </div>
    </div>
  );
}

// ── Bulk Delete Modal ────────────────────────────────────────────────────
function BulkDeleteModal({ onClose, onDeleted }) {
  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const [from,    setFrom]    = useState(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to,      setTo]      = useState(fmt(today));
  const [preview, setPreview] = useState(null);
  const [busy,    setBusy]    = useState(false);

  const loadPreview = () => {
    if (!from || !to) return;
    axios.get('/api/trades/bulk/preview', { params: { from, to } })
      .then(r => setPreview(r.data.count));
  };

  const handleDelete = async () => {
    if (!window.confirm(`Permanently delete ${preview} trade${preview !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBusy(true);
    const r = await axios.delete('/api/trades/bulk', { params: { from, to } });
    onDeleted(r.data.deleted);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Bulk Delete Trades</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            Delete all trades whose <strong>open date</strong> falls within the selected range.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
            </div>
          </div>
          <button className="btn" onClick={loadPreview} disabled={!from || !to}>
            Preview
          </button>
          {preview !== null && (
            <div className={`bulk-delete-preview ${preview === 0 ? 'zero' : 'has-trades'}`}>
              {preview === 0
                ? 'No trades found in this date range.'
                : `${preview} trade${preview !== 1 ? 's' : ''} will be permanently deleted.`}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
            onClick={handleDelete}
            disabled={!preview || preview === 0 || busy}
          >
            {busy ? 'Deleting…' : `Delete ${preview ?? ''} Trade${preview !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main list ────────────────────────────────────────────────────────────
export default function TradeList() {
  const [trades,      setTrades]      = useState([]);
  const [filters,     setFilters]     = useState(EMPTY_FILTERS);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState(null);
  const [showImport,  setShowImport]  = useState(false);
  const [showBulkDel, setShowBulkDel] = useState(false);
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

  const handleRowClick = (id) => setExpandedId(prev => prev === id ? null : id);

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
          <button className="btn btn-danger btn-sm" style={{ border: '1px solid #fca5a5' }} onClick={() => setShowBulkDel(true)}>Bulk Delete</button>
          <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>+ Add Trade</button>
        </div>
      </div>

      {importToast && <div className="import-toast">{importToast}</div>}

      <div className="filters">
        <select value={filters.instrument} onChange={set('instrument')}>
          <option value="">All Instruments</option>
          <option>NIFTY</option><option>BANKNIFTY</option>
          <option>FINNIFTY</option><option>MIDCPNIFTY</option>
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
        <div className="table-scroll-wrap">
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
                    title="Click to edit · Open full detail from edit panel"
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
        </div>
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {showBulkDel && (
        <BulkDeleteModal
          onClose={() => setShowBulkDel(false)}
          onDeleted={(count) => {
            setShowBulkDel(false);
            fetchTrades();
            setImportToast(`${count} trade${count !== 1 ? 's' : ''} deleted.`);
            setTimeout(() => setImportToast(''), 4000);
          }}
        />
      )}
    </div>
  );
}
