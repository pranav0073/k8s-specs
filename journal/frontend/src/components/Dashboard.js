import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const GREEN = '#16a34a';
const RED   = '#dc2626';
const BLUE  = '#2563eb';

const ttStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 };

export default function Dashboard() {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/trades/stats')
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;

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
    equityCurve, pnlByMonth, pnlByStrategy,
  } = stats;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      <div className="stat-cards">
        <StatCard label="Total P&L"        value={`${totalPnl >= 0 ? '+' : ''}₹${totalPnl.toFixed(0)}`} color={totalPnl >= 0 ? 'green' : 'red'} />
        <StatCard label="Win Rate"         value={`${winRate}%`}  color="blue" />
        <StatCard label="Total Trades"     value={total} />
        <StatCard label="Winners / Losers" value={`${winners} / ${losers}`} />
        <StatCard label="Avg Win"          value={`₹${avgWin.toFixed(0)}`}          color="green" />
        <StatCard label="Avg Loss"         value={`₹${Math.abs(avgLoss).toFixed(0)}`} color="red" />
      </div>

      {equityCurve.length > 1 && (
        <div className="chart-section">
          <h2>Equity Curve</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `₹${v}`} />
              <Tooltip contentStyle={ttStyle} formatter={v => [`₹${v}`, 'Cumulative P&L']} />
              <Line type="monotone" dataKey="pnl" stroke={BLUE} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {pnlByMonth?.length > 0 && (
        <div className="chart-section">
          <h2>P&amp;L by Month</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pnlByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `₹${v}`} />
              <Tooltip contentStyle={ttStyle} formatter={v => [`₹${v}`, 'P&L']} />
              <Bar dataKey="pnl" radius={[4,4,0,0]}>
                {pnlByMonth.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? GREEN : RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {pnlByStrategy?.length > 0 && (
        <div className="chart-section">
          <h2>P&amp;L by Strategy</h2>
          <ResponsiveContainer width="100%" height={Math.max(160, pnlByStrategy.length * 44)}>
            <BarChart data={pnlByStrategy} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `₹${v}`} />
              <YAxis dataKey="strategy" type="category" tick={{ fontSize: 11, fill: '#64748b' }} width={120} />
              <Tooltip contentStyle={ttStyle} formatter={v => [`₹${v}`, 'P&L']} />
              <Bar dataKey="pnl" radius={[0,4,4,0]}>
                {pnlByStrategy.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? GREEN : RED} />)}
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
              <p style={{ marginBottom: 4 }}>{bestTrade.instrument} — {bestTrade.strategy || 'Options'} · {bestTrade.date}</p>
              <p className="hl-pnl">+₹{bestTrade.pnl?.toFixed(0)}</p>
            </div>
          )}
          {worstTrade && (
            <div className="trade-highlight loss">
              <h3>Worst Trade</h3>
              <p style={{ marginBottom: 4 }}>{worstTrade.instrument} — {worstTrade.strategy || 'Options'} · {worstTrade.date}</p>
              <p className="hl-pnl">₹{worstTrade.pnl?.toFixed(0)}</p>
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
