import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const EMPTY_FILTERS = { symbol: '', direction: '', status: '', strategy: '', from: '', to: '' };

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

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this trade?')) return;
    await axios.delete(`/api/trades/${id}`);
    setTrades(prev => prev.filter(t => t.id !== id));
  };

  const set = key => e => setFilters(f => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <div className="page-header">
        <h1>Trades</h1>
        <Link to="/trades/new" className="btn btn-primary">+ Add Trade</Link>
      </div>

      <div className="filters">
        <input  placeholder="Symbol"   value={filters.symbol}    onChange={set('symbol')} />
        <input  placeholder="Strategy" value={filters.strategy}  onChange={set('strategy')} />
        <select value={filters.direction} onChange={set('direction')}>
          <option value="">All Directions</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select value={filters.status} onChange={set('status')}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <input type="date" value={filters.from} onChange={set('from')} title="From date" />
        <input type="date" value={filters.to}   onChange={set('to')}   title="To date" />
        <button className="btn btn-primary" onClick={fetchTrades}>Filter</button>
        <button className="btn btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : trades.length === 0 ? (
        <div className="empty-state">
          <h2>No trades found</h2>
          <p>Try adjusting your filters or add a new trade.</p>
        </div>
      ) : (
        <table className="trades-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Direction</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Qty</th>
              <th>P&amp;L</th>
              <th>Status</th>
              <th>Strategy</th>
              <th>Tags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td><strong>{t.symbol}</strong></td>
                <td><span className={`badge ${t.direction}`}>{t.direction}</span></td>
                <td>${t.entry_price}</td>
                <td>{t.exit_price != null ? `$${t.exit_price}` : '—'}</td>
                <td>{t.quantity}</td>
                <td className={t.pnl == null ? '' : t.pnl >= 0 ? 'green' : 'red'}>
                  {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`}
                </td>
                <td><span className={`badge status-${t.status}`}>{t.status}</span></td>
                <td>{t.strategy || '—'}</td>
                <td>{t.tags.length > 0 ? t.tags.join(', ') : '—'}</td>
                <td className="actions">
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
