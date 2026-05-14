import React, { useEffect, useState } from 'react';
import axios from 'axios';

const TREND_META = {
  strong_bullish: { label: 'Strong Bullish', icon: '▲▲', cls: 'pos' },
  bullish:        { label: 'Bullish',         icon: '▲',  cls: 'pos' },
  sideways:       { label: 'Sideways',        icon: '→',  cls: 'neutral' },
  bearish:        { label: 'Bearish',         icon: '▼',  cls: 'neg' },
  strong_bearish: { label: 'Strong Bearish',  icon: '▼▼', cls: 'neg' },
};

const HV_META = {
  high:    { label: 'High (>20%)',    cls: 'hv-high',    tip: 'Options are expensive — premium selling favoured' },
  normal:  { label: 'Normal (12-20%)',cls: 'hv-normal',  tip: 'Balanced environment — spreads and condors work well' },
  low:     { label: 'Low (<12%)',     cls: 'hv-low',     tip: 'Options are cheap — premium buying favoured' },
  unknown: { label: 'Insufficient data', cls: 'hv-normal', tip: '' },
};

const SIDE_META = {
  buy:     { label: 'Buy',     cls: 'side-buy' },
  sell:    { label: 'Sell',    cls: 'side-sell' },
  neutral: { label: 'Neutral', cls: 'side-neutral' },
};

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function RangeBar({ ranges, currentClose }) {
  if (!ranges || ranges.length === 0) return null;
  const absMin = ranges[ranges.length - 1].low;
  const absMax = ranges[ranges.length - 1].high;
  const span   = absMax - absMin || 1;

  const pct = v => ((v - absMin) / span * 100).toFixed(2) + '%';
  const width = (lo, hi) => ((hi - lo) / span * 100).toFixed(2) + '%';

  return (
    <div className="range-chart">
      {ranges.map(r => (
        <div key={r.week} className="range-row">
          <div className="range-label">Week {r.week}</div>
          <div className="range-track">
            <div
              className="range-bar"
              style={{ left: pct(r.low), width: width(r.low, r.high) }}
            />
            <div
              className="range-center"
              style={{ left: pct(currentClose) }}
              title={`Current: ${fmt(currentClose)}`}
            />
          </div>
          <div className="range-values">
            <span className="neg">{fmt(r.low)}</span>
            <span className="range-pm">±{fmt(r.move)}</span>
            <span className="pos">{fmt(r.high)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NiftyAnalysis() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    axios.get('/api/sessions/analysis')
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => { setError('Failed to load analysis'); setLoading(false); });
  }, []);

  if (loading) return <div className="loading">Calculating…</div>;
  if (error)   return <div className="empty-state"><h2>{error}</h2></div>;

  if (data?.insufficient) {
    return (
      <div className="analysis-page">
        <div className="page-header"><h1>NIFTY Analysis</h1></div>
        <div className="empty-state">
          <h2>Not enough data yet</h2>
          <p>Add at least 3 sessions with OHLC data in the Journal to generate analysis.<br />
            You have <strong>{data.dataPoints}</strong> session{data.dataPoints !== 1 ? 's' : ''} so far.</p>
        </div>
      </div>
    );
  }

  const trend   = TREND_META[data.trend]   || TREND_META.sideways;
  const hvMeta  = HV_META[data.hvLevel]   || HV_META.normal;

  return (
    <div className="analysis-page">
      <div className="page-header">
        <div>
          <h1>NIFTY Analysis</h1>
          <span className="cl-subtitle">Based on {data.dataPoints} sessions · last updated {data.latestDate}</span>
        </div>
      </div>

      {/* ── Key metrics ──────────────────────────────────────────── */}
      <div className="an-metrics">
        <div className="an-metric-card">
          <div className="an-metric-label">NIFTY Close</div>
          <div className="an-metric-value">{fmt(data.currentClose)}</div>
          <div className="an-metric-sub">{data.latestDate}</div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">Avg Daily Range (ATR)</div>
          <div className="an-metric-value">{data.atr != null ? fmt(data.atr) : '—'}</div>
          <div className="an-metric-sub">points (up to 14-day)</div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">Historical Volatility</div>
          <div className={`an-metric-value ${hvMeta.cls}`}>
            {data.hvUsed != null ? data.hvUsed + '%' : '—'}
          </div>
          <div className="an-metric-sub" title={hvMeta.tip}>{hvMeta.label}</div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">5-Day Trend</div>
          <div className={`an-metric-value ${trend.cls}`}>
            {trend.icon} {Math.abs(data.trendPct)}%
          </div>
          <div className="an-metric-sub">{trend.label}</div>
        </div>
      </div>

      {/* ── HV detail row ────────────────────────────────────────── */}
      {(data.hv10 || data.hv20) && (
        <div className="an-hv-row">
          {data.hv10 && <span>HV-10: <strong>{data.hv10}%</strong></span>}
          {data.hv20 && <span>HV-20: <strong>{data.hv20}%</strong></span>}
          {data.weeklyMove && <span>Weekly Expected Move: <strong>±{fmt(data.weeklyMove)} pts</strong></span>}
          <span className="an-hv-note">{hvMeta.tip}</span>
        </div>
      )}

      {/* ── Weekly range chart ───────────────────────────────────── */}
      <div className="form-card">
        <h3>Expected Range — Next 4 Weeks</h3>
        <p className="an-chart-note">
          Projected ±1σ range based on {data.hvUsed != null ? `HV (${data.hvUsed}%)` : 'ATR'}.
          Wider bars = more uncertainty further out. Actual price may exceed these bounds.
        </p>
        <RangeBar ranges={data.weeklyRanges} currentClose={data.currentClose} />
        <div className="range-legend">
          <span><span className="legend-bar" /> Expected range (±1σ)</span>
          <span><span className="legend-dot" /> Current NIFTY ({fmt(data.currentClose)})</span>
        </div>
      </div>

      {/* ── Strategy recommendations ─────────────────────────────── */}
      <div className="form-card">
        <h3>Suggested Strategies</h3>
        <p className="an-chart-note">
          Based on {hvMeta.label} volatility + {trend.label.toLowerCase()} trend.
          Strikes rounded to nearest 50. Verify with live IV before placing trades.
        </p>
        <div className="an-strategies">
          {data.strategies.map((s, i) => {
            const side = SIDE_META[s.side] || SIDE_META.neutral;
            return (
              <div key={i} className={`an-strategy-card ${s.fit === 'high' ? 'fit-high' : 'fit-medium'}`}>
                <div className="an-strategy-header">
                  <div className="an-strategy-name">{s.name}</div>
                  <div className="an-strategy-badges">
                    <span className={`an-fit-badge ${s.fit}`}>{s.fit === 'high' ? '★ Best fit' : 'Alt fit'}</span>
                    <span className={`an-side-badge ${side.cls}`}>{side.label}</span>
                  </div>
                </div>
                {s.strikes && (
                  <div className="an-strikes">{s.strikes}</div>
                )}
                <div className="an-strategy-desc">{s.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="an-disclaimer">
        This analysis is based on historical price data only and does not constitute financial advice.
        Always assess live IV, market conditions, and your own risk tolerance before trading.
      </div>
    </div>
  );
}
