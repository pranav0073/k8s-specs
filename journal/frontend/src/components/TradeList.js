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


// ── Merge Modal ──────────────────────────────────────────────────────────
function MergeModal({ trades, onClose, onMerged }) {
  const instruments   = [...new Set(trades.map(t => t.instrument))];
  const mixedInstr    = instruments.length > 1;
  const allLegs       = trades.flatMap(t => t.legs);
  const earliestDate  = [...trades.map(t => t.date)].sort()[0];
  const latestClose   = [...trades.map(t => t.close_date).filter(Boolean)].sort().at(-1) || '';
  const allClosed     = trades.every(t => t.status === 'closed');

  const [instrument, setInstrument] = useState(instruments[0]);
  const [date,       setDate]       = useState(earliestDate);
  const [strategy,   setStrategy]   = useState('');
  const [status,     setStatus]     = useState(allClosed ? 'closed' : 'open');
  const [closeDate,  setCloseDate]  = useState(latestClose);
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState('');

  const handleMerge = async () => {
    setBusy(true);
    setErr('');
    try {
      const combinedNotes = trades.map(t => t.notes).filter(Boolean).join('\n---\n');
      const combinedTags  = [...new Set(trades.flatMap(t => Array.isArray(t.tags) ? t.tags : []))];
      await axios.post('/api/trades', {
        date,
        instrument,
        strategy: strategy || null,
        status,
        close_date: status === 'closed' ? (closeDate || date) : null,
        legs: allLegs,
        notes: combinedNotes || null,
        tags: combinedTags,
      });
      for (const t of trades) {
        await axios.delete(`/api/trades/${t.id}`);
      }
      onMerged();
      onClose();
    } catch {
      setErr('Merge failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Merge {trades.length} Trades</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {mixedInstr && (
            <div style={{ fontSize: 13, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 12px', color: '#92400e' }}>
              Warning: selected trades have different instruments ({instruments.join(', ')}). Choose which to use below.
            </div>
          )}

          {/* Trades being merged */}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Merging</div>
            {trades.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{t.date} · <strong>{t.instrument}</strong> · {t.legs.length} leg{t.legs.length !== 1 ? 's' : ''}</span>
                <span className={`status-badge ${t.status}`}>{t.status}</span>
              </div>
            ))}
          </div>

          {/* Combined legs preview */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Combined legs ({allLegs.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {allLegs.map((l, i) => (
                <span key={i} className={`leg-pill ${l.side === 'B' ? 'buy' : 'sell'}`}>
                  <span className={`leg-dot ${l.side === 'B' ? 'buy' : 'sell'}`} />
                  <span className="leg-strike">{l.strike}</span>
                  <span className="leg-otype">{l.type}</span>
                  <span className="leg-sep">·</span>
                  <span className="leg-lots">{l.lots}L</span>
                  <span className="leg-expiry">{l.expiry}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Fields for merged trade */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Instrument</label>
              <select value={instrument} onChange={e => setInstrument(e.target.value)}>
                <option>NIFTY</option><option>BANKNIFTY</option>
                <option>FINNIFTY</option><option>MIDCPNIFTY</option>
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Strategy</label>
              <input list="merge-strat-list" value={strategy} onChange={e => setStrategy(e.target.value)} placeholder="Select or type…" />
              <datalist id="merge-strat-list">
                {STRATEGIES.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="open">open</option>
                <option value="closed">closed</option>
              </select>
            </div>
            {status === 'closed' && (
              <div className="form-group">
                <label>Close Date</label>
                <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} />
              </div>
            )}
          </div>

          {err && <div style={{ fontSize: 13, color: 'var(--red)', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px' }}>{err}</div>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMerge} disabled={busy}>
            {busy ? 'Merging…' : `Merge into 1 Trade`}
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
  const [importToast, setImportToast] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting,    setDeleting]    = useState(false);
  const [showMerge,   setShowMerge]   = useState(false);
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
    if (selectedIds.size > 0) return; // in select mode, row click is handled by checkbox
    setExpandedId(prev => prev === id ? null : id);
  };

  const toggleSelect = (e, id) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setExpandedId(null);
  };

  const toggleAll = (e) => {
    setSelectedIds(e.target.checked ? new Set(trades.map(t => t.id)) : new Set());
  };

  const handleSave = async (id, payload) => {
    await axios.put(`/api/trades/${id}`, payload);
    setExpandedId(null);
    fetchTrades();
  };

  const handleDelete = async (id) => {
    await axios.delete(`/api/trades/${id}`);
    setExpandedId(null);
    setTrades(p => p.filter(t => t.id !== id));
  };

  const handleDeleteSelected = async () => {
    setDeleting(true);
    let count = 0;
    for (const id of selectedIds) {
      try { await axios.delete(`/api/trades/${id}`); count++; } catch {}
    }
    setSelectedIds(new Set());
    setDeleting(false);
    fetchTrades();
    setImportToast(`${count} trade${count !== 1 ? 's' : ''} deleted.`);
    setTimeout(() => setImportToast(''), 4000);
  };

  const handleImported = (count) => {
    fetchTrades();
    setImportToast(`${count} trade${count !== 1 ? 's' : ''} imported successfully.`);
    setTimeout(() => setImportToast(''), 4000);
  };

  const set = key => e => setFilters(f => ({ ...f, [key]: e.target.value }));

  const allSelected = trades.length > 0 && selectedIds.size === trades.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div>
      <div className="page-header">
        <h1>Trades</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {someSelected ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{selectedIds.size} selected</span>
              {selectedIds.size >= 2 && (
                <button className="btn btn-primary" onClick={() => setShowMerge(true)}>
                  Merge {selectedIds.size}
                </button>
              )}
              <button className="btn" style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
                onClick={handleDeleteSelected} disabled={deleting}>
                {deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
              <button className="btn btn-ghost" onClick={() => setSelectedIds(new Set())}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setShowImport(true)}>Import CSV</button>
              <button className="btn btn-primary" onClick={() => navigate('/trades/new')}>+ Add Trade</button>
            </>
          )}
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
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
              </th>
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
              const isChecked  = selectedIds.has(t.id);
              return (
                <React.Fragment key={t.id}>
                  <tr
                    className={`data-row${isExpanded ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}${isChecked ? ' row-checked' : ''}`}
                    onClick={() => handleRowClick(t.id)}
                    title="Click to edit · Open full detail from edit panel"
                  >
                    <td onClick={e => toggleSelect(e, t.id)} className="td-check">
                      <input type="checkbox" checked={isChecked} onChange={() => {}} />
                    </td>
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
                      <td colSpan={8}>
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

      {showMerge && (
        <MergeModal
          trades={trades.filter(t => selectedIds.has(t.id))}
          onClose={() => setShowMerge(false)}
          onMerged={() => {
            setSelectedIds(new Set());
            fetchTrades();
            setImportToast('Trades merged successfully.');
            setTimeout(() => setImportToast(''), 4000);
          }}
        />
      )}
    </div>
  );
}
