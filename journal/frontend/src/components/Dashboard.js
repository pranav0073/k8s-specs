import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const GREEN = '#16a34a';
const RED   = '#dc2626';
const BLUE  = '#2563eb';
const AMBER = '#d97706';

const ttStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 };

// ── Discipline insights ──────────────────────────────────────────────────────
function buildInsights(stats) {
  const {
    total, profitFactor, avgWin, avgLoss, maxLossStreak,
    winRate, tradesByDow, winByStrategy, pnlByInstrument,
  } = stats;

  if (total < 3) {
    return [{ type: 'info', text: 'Add at least 3 closed trades to unlock discipline insights.' }];
  }

  const out = [];

  // Profit factor
  if (profitFactor !== null) {
    if (profitFactor < 1.0)
      out.push({ type: 'danger', text: `Profit factor is ${profitFactor} — you are losing more gross P&L than you win. Cut losses earlier or let winners run longer.` });
    else if (profitFactor < 1.5)
      out.push({ type: 'warn', text: `Profit factor ${profitFactor} is below 1.5. There is an edge, but improving exits could push this higher.` });
    else
      out.push({ type: 'good', text: `Strong profit factor of ${profitFactor} — your winners significantly outweigh your losers.` });
  }

  // Risk-reward
  if (avgLoss !== 0) {
    const rr = Math.abs(avgWin / avgLoss);
    if (rr < 1)
      out.push({ type: 'danger', text: `Average loss ₹${Math.abs(avgLoss).toLocaleString('en-IN')} exceeds average win ₹${avgWin.toLocaleString('en-IN')}. You need a very high win rate (>${Math.ceil((1/(1+rr))*100)}%) just to break even.` });
    else
      out.push({ type: 'good', text: `Risk-reward of ${rr.toFixed(2)} — your average win is ${rr.toFixed(1)}× your average loss.` });
  }

  // Loss streak
  if (maxLossStreak >= 4)
    out.push({ type: 'danger', text: `Max consecutive loss streak of ${maxLossStreak}. Strongly consider a mandatory break rule after 3 back-to-back losses.` });
  else if (maxLossStreak >= 3)
    out.push({ type: 'warn', text: `Max consecutive loss streak of ${maxLossStreak}. Stay disciplined — avoid revenge trading after losses.` });

  // Worst day of week
  const activeDays = (tradesByDow || []).filter(d => d.trades >= 2);
  if (activeDays.length > 0) {
    const worstDay = [...activeDays].sort((a, b) => a.pnl - b.pnl)[0];
    if (worstDay.pnl < 0)
      out.push({ type: 'warn', text: `${worstDay.day} is your weakest day — ${worstDay.trades} trades with ₹${Math.abs(worstDay.pnl).toLocaleString('en-IN')} net loss and ${worstDay.winRate}% win rate. Consider being more selective on ${worstDay.day}s.` });
    const bestDay = [...activeDays].sort((a, b) => b.pnl - a.pnl)[0];
    if (bestDay.pnl > 0 && bestDay.day !== worstDay.day)
      out.push({ type: 'good', text: `${bestDay.day} is your strongest day — ${bestDay.winRate}% win rate and ₹${bestDay.pnl.toLocaleString('en-IN')} total P&L across ${bestDay.trades} trades.` });
  }

  // Best strategy (min 2 trades)
  const qualStrats = (winByStrategy || []).filter(s => s.trades >= 2);
  if (qualStrats.length > 0) {
    const best = [...qualStrats].sort((a, b) => b.winRate - a.winRate)[0];
    out.push({ type: 'good', text: `${best.strategy} is your most consistent strategy — ${best.winRate}% win rate over ${best.trades} trades.` });
    const worst = [...qualStrats].sort((a, b) => a.pnl - b.pnl)[0];
    if (worst.pnl < 0 && worst.strategy !== best.strategy)
      out.push({ type: 'warn', text: `${worst.strategy} is dragging performance — ₹${Math.abs(worst.pnl).toLocaleString('en-IN')} net loss over ${worst.trades} trades. Review or reduce sizing.` });
  }

  // Losing instruments
  const losingInstr = (pnlByInstrument || []).filter(i => i.pnl < 0 && i.trades >= 2);
  if (losingInstr.length > 0)
    out.push({ type: 'warn', text: `${losingInstr.map(i => i.instrument).join(' & ')} ${losingInstr.length === 1 ? 'is' : 'are'} net negative. Consider reviewing your edge in ${losingInstr.length === 1 ? 'that instrument' : 'those instruments'}.` });

  return out;
}

const INSIGHT_META = {
  good:   { icon: '✓', cls: 'insight-good'   },
  warn:   { icon: '⚠', cls: 'insight-warn'   },
  danger: { icon: '✕', cls: 'insight-danger' },
  info:   { icon: 'i', cls: 'insight-info'   },
};

function InsightCard({ type, text }) {
  const { icon, cls } = INSIGHT_META[type] || INSIGHT_META.info;
  return (
    <div className={`insight-card ${cls}`}>
      <span className="insight-icon">{icon}</span>
      <span className="insight-text">{text}</span>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]     = useState(null);
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
    avgWin, avgLoss, profitFactor, expectancy,
    maxDrawdown, maxWinStreak, maxLossStreak, avgHoldDays,
    bestTrade, worstTrade,
    equityCurve, pnlByMonth, pnlByStrategy,
    winByStrategy, pnlByInstrument, tradesByDow,
  } = stats;

  const rrRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : '—';
  const insights = buildInsights(stats);

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      {/* ── Overview cards ── */}
      <div className="stat-cards">
        <StatCard label="Total P&L"        value={`${totalPnl >= 0 ? '+' : ''}₹${Math.round(totalPnl).toLocaleString('en-IN')}`} color={totalPnl >= 0 ? 'green' : 'red'} />
        <StatCard label="Win Rate"         value={`${winRate}%`} color="blue" sub={`${winners}W / ${losers}L of ${total}`} />
        <StatCard label="Profit Factor"    value={profitFactor ?? '—'} color={profitFactor === null ? '' : profitFactor >= 1.5 ? 'green' : profitFactor >= 1 ? '' : 'red'} sub="gross profit ÷ gross loss" />
        <StatCard label="Expectancy"       value={expectancy != null ? `${expectancy >= 0 ? '+' : ''}₹${Math.round(expectancy).toLocaleString('en-IN')}` : '—'} color={expectancy >= 0 ? 'green' : 'red'} sub="per trade" />
        <StatCard label="Avg Win"          value={`₹${Math.round(avgWin).toLocaleString('en-IN')}`} color="green" />
        <StatCard label="Avg Loss"         value={`₹${Math.round(Math.abs(avgLoss)).toLocaleString('en-IN')}`} color="red" sub={`R:R ${rrRatio}`} />
        <StatCard label="Max Drawdown"     value={maxDrawdown > 0 ? `₹${Math.round(maxDrawdown).toLocaleString('en-IN')}` : '—'} color={maxDrawdown > 0 ? 'red' : ''} />
        <StatCard label="Best Streak"      value={`${maxWinStreak}W`} color="green" sub={`worst: ${maxLossStreak}L`} />
        {avgHoldDays != null && <StatCard label="Avg Hold" value={`${avgHoldDays}d`} />}
      </div>

      {/* ── Equity Curve ── */}
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

      {/* ── Discipline Insights ── */}
      <div className="chart-section insights-section">
        <h2>Discipline Insights</h2>
        <div className="insights-list">
          {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
        </div>
      </div>

      {/* ── Day-of-week pattern ── */}
      {tradesByDow?.length > 0 && (
        <div className="chart-section">
          <h2>P&amp;L by Day of Week</h2>
          <div className="dow-wrap">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={tradesByDow} barSize={36}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `₹${v}`} />
                <Tooltip
                  contentStyle={ttStyle}
                  formatter={(v, name) => name === 'pnl' ? [`₹${v}`, 'P&L'] : [`${v}%`, 'Win Rate']}
                />
                <Bar dataKey="pnl" radius={[4,4,0,0]}>
                  {tradesByDow.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Win rate dots per day */}
            <div className="dow-wr-row">
              {tradesByDow.map(d => (
                <div key={d.day} className="dow-wr-cell">
                  <span className={`dow-wr-pct ${d.winRate >= 50 ? 'pos' : 'neg'}`}>{d.winRate}%</span>
                  <span className="dow-wr-label">{d.trades}T</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Strategy performance ── */}
      {winByStrategy?.length > 0 && (
        <div className="chart-section">
          <h2>Strategy Performance</h2>
          <div className="table-scroll-wrap" style={{ border: 'none' }}>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th style={{ textAlign: 'right' }}>Trades</th>
                  <th style={{ textAlign: 'right' }}>Win Rate</th>
                  <th style={{ textAlign: 'right' }}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {winByStrategy.map(s => (
                  <tr key={s.strategy}>
                    <td>{s.strategy}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{s.trades}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="wr-bar-wrap">
                        <span className="wr-bar-fill" style={{ width: `${s.winRate}%`, background: s.winRate >= 50 ? GREEN : AMBER }} />
                        <span className="wr-bar-label" style={{ color: s.winRate >= 50 ? GREEN : AMBER }}>{s.winRate}%</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: s.pnl >= 0 ? GREEN : RED }}>
                      {s.pnl >= 0 ? '+' : ''}₹{Math.abs(Math.round(s.pnl)).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── P&L by Month ── */}
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

      {/* ── P&L by Instrument ── */}
      {pnlByInstrument?.length > 1 && (
        <div className="chart-section">
          <h2>P&amp;L by Instrument</h2>
          <ResponsiveContainer width="100%" height={Math.max(120, pnlByInstrument.length * 50)}>
            <BarChart data={pnlByInstrument} layout="vertical" barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `₹${v}`} />
              <YAxis dataKey="instrument" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
              <Tooltip contentStyle={ttStyle} formatter={(v, n) => n === 'pnl' ? [`₹${v}`, 'P&L'] : [`${v}%`, 'Win Rate']} />
              <Bar dataKey="pnl" radius={[0,4,4,0]}>
                {pnlByInstrument.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? GREEN : RED} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── P&L by Strategy ── */}
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

      {/* ── Best / Worst ── */}
      {(bestTrade || worstTrade) && (
        <div className="best-worst">
          {bestTrade && (
            <div className="trade-highlight win">
              <h3>Best Trade</h3>
              <p style={{ marginBottom: 4 }}>{bestTrade.instrument} — {bestTrade.strategy || 'Options'} · {bestTrade.date}</p>
              <p className="hl-pnl">+₹{Math.round(bestTrade.pnl).toLocaleString('en-IN')}</p>
            </div>
          )}
          {worstTrade && (
            <div className="trade-highlight loss">
              <h3>Worst Trade</h3>
              <p style={{ marginBottom: 4 }}>{worstTrade.instrument} — {worstTrade.strategy || 'Options'} · {worstTrade.date}</p>
              <p className="hl-pnl">₹{Math.round(worstTrade.pnl).toLocaleString('en-IN')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
