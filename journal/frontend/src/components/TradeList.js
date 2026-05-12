import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const LOT_SIZE = 65;
const EMPTY_FILTERS = { instrument: '', strategy: '', status: '', from: '', to: '' };

function LegsSummary({ legs }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {legs.map((l, i) => (
        <span key={i} className={`leg-badge ${l.side === 'B' ? 'buy' : 'sell'}`}>
          {l.side} {l.lots}L {l.strike}{l.type} {l.expiry}
        </span>
      ))}
    </div>
  );
}

function calcMtm(legs, ltps) {
  let allEntered = true;
  const total = legs.reduce((sum, leg, i) => {
    const ltp = parseFloat(ltps?.[i]);
    if (isNaN(ltp)) { allEntered = false; return sum; }
    const mult = leg.side === 'B' ? 1 : -1;
    return sum + (ltp - leg.entry_price) * LOT_SIZE * leg.lots * mult;
  }, 0);
  return { total: Math.round(total), allEntered };
}

function MtmRow({ trade, ltps, onLtpChange }) {
  return (
    <tr className="mtm-expand-row">
      <td colSpan={9}>
        <div className="mtm-form">
          <table className="mtm-table">
            <thead>
              <tr>
                <th>Side</th>
                <th>Strike</th>
                <th>Type</th>
                <th>Lots</th>
                <th>Entry ₹</th>
                <th>LTP ₹</th>
                <th>Leg MTM</th>
              </tr>
            </thead>
            <tbody>
              {trade.legs.map((leg, i) => {
                const ltp = parseFloat(ltps?.[i]);
                const legMtm = isNaN(ltp)
                  ? null
                  : Math.round((ltp - leg.entry_price) * LOT_SIZE * leg.lots * (leg.side === 'B' ? 1 : -1));
                return (
                  <tr key={i} className={leg.side === 'B' ? 'buy-row' : 'sell-row'}>
                    <td><span className={`side-${leg.side}`}>{leg.side}</span></td>
                    <td>{leg.strike}</td>
                    <td>{leg.type}</td>
                    <td>{leg.lots}</td>
                    <td>₹{leg.entry_price}</td>
                    <td>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={ltps?.[i] ?? ''}
                        onChange={e => onLtpChange(i, e.target.value)}
                        placeholder="0.00"
                        className="ltp-input"
                        autoFocus={i === 0}
                      />
                    </td>
                    <td className={legMtm == null ? 'muted' : legMtm >= 0 ? 'pnl-green' : 'pnl-red'}>
                      {legMtm == null ? '—' : `${legMtm >= 0 ? '+' : ''}₹${Math.abs(legMtm).toLocaleString('en-IN')}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(() => {
            const { total, allEntered } = calcMtm(trade.legs, ltps);
            if (!Object.values(ltps || {}).some(v => v !== '' && !isNaN(parseFloat(v)))) return null;
            return (
              <div className="mtm-total">
                Estimated P&amp;L:&nbsp;
                <strong className={total >= 0 ? 'pnl-green' : 'pnl-red'}>
                  {total >= 0 ? '+' : ''}₹{Math.abs(total).toLocaleString('en-IN')}
                </strong>
                {!allEntered && <span className="mtm-partial"> (partial)</span>}
              </div>
            );
          })()}
        </div>
      </td>
    </tr>
  );
}

export default function TradeList() {
  const [trades, setTrades]     = useState([]);
  const [filters, setFilters]   = useState(EMPTY_FILTERS);
  const [loading, setLoading]   = useState(true);
  const [ltpMap, setLtpMap]     = useState({});   // { tradeId: { legIdx: value } }
  const [expandedId, setExpandedId] = useState(null);

  const fetchTrades = useCallback(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    setLoading(true);
    axios.get('/api/trades', { params })
      .then(r => { setTrades(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters]);

  useEffect(() => { fetchTrades(); }, []); // eslint-disable-line

  const handleDelete = async id => {
    if (!window.confirm('Delete this trade?')) return;
    await axios.delete(`/api/trades/${id}`);
    setTrades(p => p.filter(t => t.id !== id));
  };

  const handleLtpChange = (tradeId, legIdx, val) => {
    setLtpMap(prev => ({
      ...prev,
      [tradeId]: { ...(prev[tradeId] || {}), [legIdx]: val },
    }));
  };

  const toggleExpand = id => setExpandedId(prev => prev === id ? null : id);

  const set = key => e => setFilters(f => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <div className="page-header">
        <h1>Trades</h1>
        <Link to="/trades/new" className="btn btn-primary">+ Add Trade</Link>
      </div>

      <div className="filters">
        <select value={filters.instrument} onChange={set('instrument')}>
          <option value="">All Instruments</option>
          <option>NIFTY</option>
          <option>BANKNIFTY</option>
          <option>FINNIFTY</option>
          <option>MIDCPNIFTY</option>
        </select>
        <input placeholder="Strategy" value={filters.strategy} onChange={set('strategy')} style={{ width: 160 }} />
        <select value={filters.status} onChange={set('status')}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <input type="date" value={filters.from} onChange={set('from')} title="From date" />
        <input type="date" value={filters.to}   onChange={set('to')}   title="To date" />
        <button className="btn btn-primary" onClick={fetchTrades}>Apply</button>
        <button className="btn btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : trades.length === 0 ? (
        <div className="empty-state">
          <h2>No trades found</h2>
          <p>Add your first options trade to get started.</p>
        </div>
      ) : (
        <table className="trades-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Instrument</th>
              <th>Strategy</th>
              <th>Legs</th>
              <th>Net Premium</th>
              <th>P&amp;L</th>
              <th>Est. P&amp;L (LTP)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => {
              const ltps = ltpMap[t.id];
              const hasLtp = Object.values(ltps || {}).some(v => v !== '' && !isNaN(parseFloat(v)));
              const { total: mtm } = calcMtm(t.legs, ltps);
              const isExpanded = expandedId === t.id;

              return (
                <React.Fragment key={t.id}>
                  <tr className={isExpanded ? 'row-expanded' : ''}>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                    <td><strong>{t.instrument}</strong></td>
                    <td>{t.strategy || '—'}</td>
                    <td><LegsSummary legs={t.legs} /></td>
                    <td style={{ color: t.netPremium > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                      {t.netPremium === 0
                        ? '—'
                        : `${t.netPremium > 0 ? 'Pay' : 'Rcv'} ₹${Math.abs(t.netPremium).toFixed(0)}`}
                    </td>
                    <td className={t.pnl == null ? '' : t.pnl >= 0 ? 'pnl-green' : 'pnl-red'}>
                      {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}₹${t.pnl.toFixed(0)}`}
                    </td>

                    {/* Est. P&L column */}
                    <td>
                      {t.status === 'open' ? (
                        <div className="mtm-cell">
                          {hasLtp && (
                            <span className={`mtm-value ${mtm >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                              {mtm >= 0 ? '+' : ''}₹{Math.abs(mtm).toLocaleString('en-IN')}
                            </span>
                          )}
                          <button
                            className={`btn btn-sm mtm-toggle${isExpanded ? ' active' : ''}`}
                            onClick={() => toggleExpand(t.id)}
                            title="Enter LTP per leg"
                          >
                            {isExpanded ? '▲ LTP' : '▼ LTP'}
                          </button>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    <td><span className={`status-badge ${t.status}`}>{t.status}</span></td>
                    <td className="actions">
                      <Link to={`/trades/${t.id}`} className="btn btn-sm">View</Link>
                      <Link to={`/trades/${t.id}/edit`} className="btn btn-sm">Edit</Link>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)}>Del</button>
                    </td>
                  </tr>

                  {/* Expandable LTP row */}
                  {t.status === 'open' && isExpanded && (
                    <MtmRow
                      trade={t}
                      ltps={ltpMap[t.id] || {}}
                      onLtpChange={(legIdx, val) => handleLtpChange(t.id, legIdx, val)}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
