import React, { useEffect, useState } from 'react';
import axios from 'axios';

function scoreColor(score) {
  if (score === null || score === undefined) return '';
  if (score >= 70) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div className="behavioral-metric">
      <div className="bm-label">{label}</div>
      <div className={`bm-value ${color || ''}`}>{value}</div>
      {sub && <div className="bm-sub">{sub}</div>}
    </div>
  );
}

// Simple bar showing win rate as a horizontal fill
function WinRateBar({ label, winRate, count }) {
  const pct = winRate ?? 0;
  const color = pct >= 60 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';
  return (
    <div className="hold-bar-item">
      <div className="hold-bar-label">{label}</div>
      <div className="hold-bar-track">
        <div
          className="hold-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="hold-bar-stat" style={{ color }}>
        {winRate !== null ? `${winRate}%` : '—'}
        {count > 0 && <span className="hold-bar-count"> ({count})</span>}
      </div>
    </div>
  );
}

// Frequency heatmap pill
function FreqPill({ date, count }) {
  let bg = '#fef9c3'; // 1 trade
  let textColor = '#713f12';
  if (count >= 3) { bg = '#dc2626'; textColor = '#fff'; }
  else if (count >= 2) { bg = '#fca5a5'; textColor = '#7f1d1d'; }
  return (
    <div
      className="freq-pill"
      style={{ background: bg, color: textColor }}
      title={`${date}: ${count} trade${count !== 1 ? 's' : ''}`}
    >
      {date.slice(5)} {/* MM-DD */}
    </div>
  );
}

export default function BehavioralMetrics() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    axios.get('/api/analytics/behavioral')
      .then(r => { setData(r.data); setLoading(false); })
      .catch(err => {
        setError(err.response?.data?.error || 'Failed to load behavioral metrics');
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading behavioral metrics…</div>;
  if (error)   return <div className="error-msg">{error}</div>;
  if (!data)   return null;

  const {
    disciplineScore,
    revengeTrades,
    overtradingDays,
    lotConsistency,
    strategyDrift,
    expiryWeekStats,
    tradesByDate,
    holdDurationBuckets,
  } = data;

  const dsColor = scoreColor(disciplineScore);

  return (
    <div className="chart-section">
      <h2>Behavioral Analytics</h2>

      {/* Discipline Score */}
      {disciplineScore !== null && (
        <div className={`discipline-score-card discipline-${dsColor}`}>
          <div className="ds-label">Discipline Score</div>
          <div className={`ds-number ${dsColor}`}>{disciplineScore}</div>
          <div className="ds-sub">
            {disciplineScore >= 70 ? 'Consistent trader' : disciplineScore >= 50 ? 'Room for improvement' : 'Needs attention'}
          </div>
        </div>
      )}

      {/* Behavioral metric grid */}
      <div className="behavioral-grid">
        <MetricCard
          label="Revenge Trades"
          value={revengeTrades.length}
          sub="trades after same-day loss"
          color={revengeTrades.length > 0 ? 'red' : 'green'}
        />
        <MetricCard
          label="Overtrading Days"
          value={overtradingDays.length}
          sub="days with 3+ trades"
          color={overtradingDays.length > 2 ? 'red' : overtradingDays.length > 0 ? 'amber' : 'green'}
        />
        <MetricCard
          label="Lot Consistency"
          value={`${lotConsistency}/100`}
          sub="lower variance = higher score"
          color={scoreColor(lotConsistency)}
        />
        <MetricCard
          label="Strategy Drift"
          value={strategyDrift}
          sub="strategy changes after loss"
          color={strategyDrift > 3 ? 'red' : strategyDrift > 1 ? 'amber' : 'green'}
        />
        {expiryWeekStats.expiryTrades > 0 && (
          <MetricCard
            label="Expiry (Thu) Win Rate"
            value={expiryWeekStats.expiryWinRate !== null ? `${expiryWeekStats.expiryWinRate}%` : '—'}
            sub={`vs ${expiryWeekStats.normalWinRate ?? '—'}% non-expiry · ${expiryWeekStats.expiryTrades} trades`}
            color={scoreColor(expiryWeekStats.expiryWinRate)}
          />
        )}
      </div>

      {/* Trade frequency heatmap */}
      {tradesByDate.length > 0 && (
        <div className="bm-section">
          <div className="bm-section-title">Trade Frequency (last 60 days)</div>
          <div className="freq-heatmap">
            {tradesByDate.map(({ date, count }) => (
              <FreqPill key={date} date={date} count={count} />
            ))}
          </div>
          <div className="freq-legend">
            <span className="freq-pill" style={{ background: '#fef9c3', color: '#713f12' }}>1 trade</span>
            <span className="freq-pill" style={{ background: '#fca5a5', color: '#7f1d1d' }}>2 trades</span>
            <span className="freq-pill" style={{ background: '#dc2626', color: '#fff' }}>3+ trades</span>
          </div>
        </div>
      )}

      {/* Hold duration performance */}
      {Object.values(holdDurationBuckets).some(b => b.count > 0) && (
        <div className="bm-section">
          <div className="bm-section-title">Win Rate by Hold Duration</div>
          <div className="hold-bars">
            <WinRateBar label="Same Day"   winRate={holdDurationBuckets.sameDay.winRate} count={holdDurationBuckets.sameDay.count} />
            <WinRateBar label="Short (1-3d)" winRate={holdDurationBuckets.short.winRate}   count={holdDurationBuckets.short.count} />
            <WinRateBar label="Medium (4-14d)" winRate={holdDurationBuckets.medium.winRate} count={holdDurationBuckets.medium.count} />
            <WinRateBar label="Long (15+d)"  winRate={holdDurationBuckets.long.winRate}   count={holdDurationBuckets.long.count} />
          </div>
        </div>
      )}
    </div>
  );
}
