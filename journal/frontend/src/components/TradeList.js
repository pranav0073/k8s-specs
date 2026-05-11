import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

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

export default function TradeList() {
  const [trades, setTrades]   = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);

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
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id}>
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
                <td><span className={`status-badge ${t.status}`}>{t.status}</span></td>
                <td className="actions">
                  <Link to={`/trades/${t.id}`} className="btn btn-sm">View</Link>
                  <Link to={`/trades/${t.id}/edit`} className="btn btn-sm">Edit</Link>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
