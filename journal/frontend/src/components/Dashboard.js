import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/trades/stats')
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  if (!stats || stats.total === 0) {
    return (
      <div className="empty-state">
        <h2>No closed trades yet</h2>
        <p>Add and close trades to see your stats and charts here.</p>
      </div>
    );
  }

  const {
    totalPnl, winRate, total, winners, losers,
    avgWin, avgLoss, bestTrade, worstTrade,
    equityCurve, pnlByMonth, pnlBySymbol,
  } = stats;

  return (
    <div className="dashboard">
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Dashboard</h1>

      <div className="stat-cards">
        <StatCard label="Total P&L"        value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? 'green' : 'red'} />
        <StatCard label="Win Rate"         value={`${winRate}%`} />
        <StatCard label="Total Trades"     value={total} />
        <StatCard label="Winners / Losers" value={`${winners} / ${losers}`} />
        <StatCard label="Avg Win"          value={`$${avgWin.toFixed(2)}`}  color="green" />
        <StatCard label="Avg Loss"         value={`$${avgLoss.toFixed(2)}`} color="red" />
      </div>

      {equityCurve.length > 1 && (
        <div className="chart-section">
          <h2>Equity Curve</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3244" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#1a1d27', border: '1px solid #2e3244' }}
                formatter={v => [`$${v}`, 'Cumulative P&L']}
              />
              <Line type="monotone" dataKey="pnl" stroke="#4ade80" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {pnlByMonth.length > 0 && (
        <div className="chart-section">
          <h2>P&L by Month</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pnlByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3244" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#1a1d27', border: '1px solid #2e3244' }}
                formatter={v => [`$${v}`, 'P&L']}
              />
              <Bar dataKey="pnl">
                {pnlByMonth.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? '#4ade80' : '#f87171'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {pnlBySymbol.length > 0 && (
        <div className="chart-section">
          <h2>P&L by Symbol</h2>
          <ResponsiveContainer width="100%" height={Math.max(180, pnlBySymbol.length * 36)}>
            <BarChart data={pnlBySymbol} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3244" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis dataKey="symbol" type="category" tick={{ fontSize: 11, fill: '#94a3b8' }} width={70} />
              <Tooltip
                contentStyle={{ background: '#1a1d27', border: '1px solid #2e3244' }}
                formatter={v => [`$${v}`, 'P&L']}
              />
              <Bar dataKey="pnl">
                {pnlBySymbol.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? '#4ade80' : '#f87171'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {(bestTrade || worstTrade) && (
        <div className="best-worst">
          {bestTrade && (
            <div className="trade-highlight win">
              <h3>Best Trade</h3>
              <p>{bestTrade.symbol} &mdash; {bestTrade.date}</p>
              <p className="pnl">+${bestTrade.pnl?.toFixed(2)}</p>
            </div>
          )}
          {worstTrade && (
            <div className="trade-highlight loss">
              <h3>Worst Trade</h3>
              <p>{worstTrade.symbol} &mdash; {worstTrade.date}</p>
              <p className="pnl">${worstTrade.pnl?.toFixed(2)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>{value}</div>
    </div>
  );
}
