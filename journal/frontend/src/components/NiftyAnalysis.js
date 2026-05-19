import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

const AI_SECTION_META = {
  'Market Outlook':      { icon: '📊', cls: 'ep-outlook',  label: 'Market Outlook' },
  'Top Strategy':        { icon: '🎯', cls: 'ep-target',   label: 'Top Strategy' },
  'Alternative Strategy':{ icon: '🔄', cls: 'ep-time',     label: 'Alternative Strategy' },
  'Key Risks':           { icon: '⚠️', cls: 'ep-adjust',   label: 'Key Risks' },
  'Levels to Watch':     { icon: '📍', cls: 'ep-levels',   label: 'Levels to Watch' },
};

function parseAiSections(text) {
  return text.split(/^## /m).filter(Boolean).map(sec => {
    const nl    = sec.indexOf('\n');
    const title = nl === -1 ? sec.trim() : sec.slice(0, nl).trim();
    const body  = nl === -1 ? '' : sec.slice(nl + 1).trim();
    const meta  = AI_SECTION_META[title] || { icon: '•', cls: '', label: title };
    return { title, body, meta };
  });
}

// ── Candlestick chart ─────────────────────────────────────────────────────────
function CandleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const bull = d.close >= d.open;
  return (
    <div style={{
      background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
      padding: '8px 12px', fontSize: 12, color: '#e5e5e5', lineHeight: 1.7,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#fff' }}>{d.date}</div>
      <div>O <strong>{d.open?.toFixed(2)}</strong></div>
      <div>H <strong style={{ color: '#4ade80' }}>{d.high?.toFixed(2)}</strong></div>
      <div>L <strong style={{ color: '#f87171' }}>{d.low?.toFixed(2)}</strong></div>
      <div>C <strong style={{ color: bull ? '#4ade80' : '#f87171' }}>{d.close?.toFixed(2)}</strong></div>
      <div style={{ color: bull ? '#4ade80' : '#f87171', marginTop: 2 }}>
        {bull ? '▲' : '▼'} {Math.abs(d.close - d.open).toFixed(2)} ({Math.abs((d.close - d.open) / d.open * 100).toFixed(2)}%)
      </div>
    </div>
  );
}

function CandlestickChart({ candles }) {
  if (!candles || candles.length === 0) return null;

  // Transform for Recharts: each candle needs [bodyLow, bodyHigh] as a bar,
  // plus separate thin bars for upper/lower wicks.
  const data = candles.map(c => {
    const bull     = c.close >= c.open;
    const bodyLow  = Math.min(c.open, c.close);
    const bodyHigh = Math.max(c.open, c.close);
    return {
      ...c,
      bull,
      // Bar stacking: [gap from 0 to bodyLow] + [body height]
      bodyBase:   bodyLow,
      bodySize:   bodyHigh - bodyLow || 1, // min 1pt so flat candles show
      upperWick:  c.high - bodyHigh,
      lowerWick:  bodyLow - c.low,
      wickBase:   c.low,
      wickSize:   c.high - c.low,
      label:      c.date.slice(5), // "MM-DD"
    };
  });

  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.floor(Math.min(...allPrices) / 50) * 50;
  const maxP = Math.ceil(Math.max(...allPrices) / 50) * 50;

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[minP, maxP]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            tickFormatter={v => v.toLocaleString('en-IN')} width={58} />
          <Tooltip content={<CandleTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />

          {/* Full wick — thin transparent bar so tooltip works on full height */}
          <Bar dataKey="wickSize" stackId="c" bottomValue="wickBase" fill="transparent" stroke="none" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill="transparent" />
            ))}
          </Bar>

          {/* Lower wick line — invisible bar placeholder */}
          <Bar dataKey="lowerWick" stackId="w" bottomValue="wickBase" barSize={2} isAnimationActive={false} radius={0}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.bull ? '#16a34a' : '#dc2626'} />
            ))}
          </Bar>

          {/* Gap bar (transparent, from 0 to bodyBase) */}
          <Bar dataKey="bodyBase" stackId="b" fill="transparent" stroke="none" isAnimationActive={false} />

          {/* Candle body */}
          <Bar dataKey="bodySize" stackId="b" barSize={14} isAnimationActive={false} radius={[1,1,1,1]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.bull ? '#16a34a' : '#dc2626'}
                fillOpacity={d.bull ? 0.85 : 0.9}
                stroke={d.bull ? '#15803d' : '#b91c1c'} strokeWidth={1} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AiAnalysisPanel({ candles }) {
  const [analysis,    setAnalysis]    = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    axios.get('/api/sessions/ai-analysis').then(r => {
      if (r.data.analysis) {
        setAnalysis(r.data.analysis);
        setGeneratedAt(r.data.generatedAt);
      }
    }).catch(() => {});
  }, []);

  const generate = async () => {
    setLoading(true); setError('');
    try {
      const r = await axios.post('/api/sessions/ai-analysis');
      setAnalysis(r.data.analysis);
      setGeneratedAt(r.data.generatedAt);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to generate analysis');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-card" style={{ padding: 0 }}>
      <div className="ep-header">
        <div>
          <div className="ep-title">✦ AI Market Analysis</div>
          {generatedAt && (
            <div className="ep-timestamp">
              Generated: {new Date(generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={generate}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {loading ? <><span className="ep-spinner" /> Analysing…</> : analysis ? '↻ Refresh' : '✦ Generate'}
        </button>
      </div>

      {error && <div className="ep-error">{error}</div>}

      {!analysis && !loading && (
        <div className="ep-empty">
          <div className="ep-empty-icon">✦</div>
          <div>Click <strong>Generate</strong> to get an AI-powered market outlook, strategy picks, key risks, and levels to watch — using live VIX, global markets, and candlestick patterns.</div>
        </div>
      )}

      {loading && (
        <div className="ep-generating">
          <div className="ep-gen-row"><span className="ep-spinner-lg" /> Fetching live data and analysing…</div>
          <div className="ep-gen-hint">India VIX · S&amp;P 500 · Crude Oil · DXY · candlestick patterns</div>
        </div>
      )}

      {analysis && !loading && (
        <div className="ep-sections">
          {parseAiSections(analysis).map((sec, i) => (
            <div key={i} className={`ep-section ${sec.meta.cls}`}>
              <div className="ep-section-title">
                <span className="ep-section-icon">{sec.meta.icon}</span>
                {sec.meta.label}
              </div>
              {sec.title === 'Market Outlook' && candles?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 600 }}>
                    NIFTY — last {candles.length} sessions (daily)
                  </div>
                  <CandlestickChart candles={candles} />
                </div>
              )}
              <div className="ep-section-body ep-md">
                <ReactMarkdown>{sec.body}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {analysis && (
        <div className="ep-disclaimer">
          AI analysis uses live market data and historical sessions. Not financial advice — verify before trading.
        </div>
      )}
    </div>
  );
}

const TREND_META = {
  strong_bullish: { label: 'Strong Bullish', icon: '▲▲', cls: 'pos' },
  bullish:        { label: 'Bullish',         icon: '▲',  cls: 'pos' },
  sideways:       { label: 'Sideways',        icon: '→',  cls: 'neutral' },
  bearish:        { label: 'Bearish',         icon: '▼',  cls: 'neg' },
  strong_bearish: { label: 'Strong Bearish',  icon: '▼▼', cls: 'neg' },
};

const VIX_META = {
  low:      { label: 'Low  (<15)',     cls: 'vix-low',      bias: 'Buy premium — options are cheap',          color: '#2563eb' },
  moderate: { label: 'Moderate (15-20)', cls: 'vix-moderate', bias: 'Balanced — spreads & condors work well',  color: '#16a34a' },
  elevated: { label: 'Elevated (20-25)', cls: 'vix-elevated', bias: 'Sell premium — IV is rich',              color: '#d97706' },
  high:     { label: 'High  (>25)',    cls: 'vix-high',     bias: 'Sell premium aggressively / hedge',        color: '#dc2626' },
};

const IV_SIGNAL_META = {
  sell:    { label: 'Options overpriced vs history → favour selling',  cls: 'iv-sell' },
  buy:     { label: 'Options cheap vs history → favour buying',        cls: 'iv-buy' },
  neutral: { label: 'Options fairly priced vs history',                cls: 'iv-neutral' },
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

function RangeBar({ ranges, currentClose, moveSource }) {
  if (!ranges || ranges.length === 0) return null;
  const absMin = ranges[ranges.length - 1].low;
  const absMax = ranges[ranges.length - 1].high;
  const span   = absMax - absMin || 1;
  const pct    = v => ((v - absMin) / span * 100).toFixed(2) + '%';
  const width  = (lo, hi) => ((hi - lo) / span * 100).toFixed(2) + '%';
  const sourceLabel = moveSource === 'vix' ? 'India VIX' : moveSource === 'hv' ? 'HV' : 'ATR';

  return (
    <div className="range-chart">
      <div className="range-source-note">Range computed from {sourceLabel} (±1σ per week)</div>
      {ranges.map(r => (
        <div key={r.week} className="range-row">
          <div className="range-label">Week {r.week}</div>
          <div className="range-track">
            <div className="range-bar" style={{ left: pct(r.low), width: width(r.low, r.high) }} />
            <div className="range-center" style={{ left: pct(currentClose) }} title={`Current: ${fmt(currentClose)}`} />
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
          <p>Add at least 3 sessions with OHLC data in the Journal.<br />
            You have <strong>{data.dataPoints}</strong> session{data.dataPoints !== 1 ? 's' : ''} so far.</p>
        </div>
      </div>
    );
  }

  const trend   = TREND_META[data.trend] || TREND_META.sideways;
  const vixMeta = data.vixLevel ? VIX_META[data.vixLevel] : null;
  const ivSig   = IV_SIGNAL_META[data.ivSignal] || IV_SIGNAL_META.neutral;
  const vixUp   = data.vixChange != null && data.vixChange >= 0;

  return (
    <div className="analysis-page">
      <div className="page-header">
        <div>
          <h1>NIFTY Analysis</h1>
          <span className="cl-subtitle">Based on {data.dataPoints} sessions · last session {data.latestDate}</span>
        </div>
      </div>

      {/* ── VIX hero card ─────────────────────────────────────────── */}
      {data.vix != null ? (
        <div className="vix-hero" style={{ borderColor: vixMeta?.color }}>
          <div className="vix-hero-left">
            <div className="vix-hero-label">India VIX  <span className="vix-live-dot" title="Live from NSE via Yahoo Finance" /></div>
            <div className="vix-hero-value" style={{ color: vixMeta?.color }}>{data.vix}</div>
            {data.vixChange != null && (
              <div className={`vix-hero-change ${vixUp ? 'neg' : 'pos'}`}>
                {vixUp ? '▲' : '▼'} {Math.abs(data.vixChange)} ({Math.abs(data.vixChangePct)}%)
                <span style={{ fontWeight: 400, marginLeft: 4 }}>vs prev day</span>
              </div>
            )}
          </div>
          <div className="vix-hero-right">
            {vixMeta && (
              <>
                <div className={`vix-level-badge ${vixMeta.cls}`}>{vixMeta.label}</div>
                <div className="vix-bias">{vixMeta.bias}</div>
              </>
            )}
            {data.vixVsHv != null && (
              <div className={`iv-signal-chip ${ivSig.cls}`}>
                VIX/HV = {data.vixVsHv}×  —  {ivSig.label}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="vix-hero vix-hero-error">
          <div className="vix-hero-label">India VIX</div>
          <div className="vix-error-msg">⚠ Could not fetch live VIX{data.vixError ? ` (${data.vixError})` : ''}. Analysis uses historical volatility.</div>
        </div>
      )}

      {/* ── Key metrics ──────────────────────────────────────────── */}
      <div className="an-metrics">
        <div className="an-metric-card">
          <div className="an-metric-label">NIFTY Close</div>
          <div className="an-metric-value">{fmt(data.currentClose)}</div>
          <div className="an-metric-sub">{data.latestDate}</div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">ATR (14-day)</div>
          <div className="an-metric-value">{data.atr != null ? fmt(data.atr) : '—'}</div>
          <div className="an-metric-sub">avg daily range (pts)</div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">Historical Volatility</div>
          <div className="an-metric-value">{data.hvUsed != null ? data.hvUsed + '%' : '—'}</div>
          <div className="an-metric-sub">
            {data.hv10 && `HV10: ${data.hv10}%`}{data.hv10 && data.hv20 && '  '}{data.hv20 && `HV20: ${data.hv20}%`}
          </div>
        </div>
        <div className="an-metric-card">
          <div className="an-metric-label">5-Day Trend</div>
          <div className={`an-metric-value ${trend.cls}`}>{trend.icon} {Math.abs(data.trendPct)}%</div>
          <div className="an-metric-sub">{trend.label}</div>
        </div>
      </div>

      {/* ── Weekly expected move callout ─────────────────────────── */}
      {data.weeklyMove != null && (
        <div className="an-move-callout">
          <span className="an-move-label">Weekly Expected Move</span>
          <span className="an-move-value">±{fmt(data.weeklyMove)} pts</span>
          <span className="an-move-range">
            ({fmt(Math.round(data.currentClose - data.weeklyMove))} – {fmt(Math.round(data.currentClose + data.weeklyMove))})
          </span>
          <span className="an-move-source">
            Source: {data.weeklyMoveSource === 'vix' ? `India VIX ${data.vix}` : data.weeklyMoveSource === 'hv' ? `HV ${data.hvUsed}%` : 'ATR'}
          </span>
        </div>
      )}

      {/* ── Weekly range chart ───────────────────────────────────── */}
      <div className="form-card">
        <h3>Expected Range — Next 4 Weeks</h3>
        <p className="an-chart-note">
          Each bar shows the ±1σ range. Week 4 is widest because uncertainty compounds with time (√n rule).
          Price can exceed these bounds — treat them as a probability band, not a hard limit.
        </p>
        <RangeBar ranges={data.weeklyRanges} currentClose={data.currentClose} moveSource={data.weeklyMoveSource} />
        <div className="range-legend">
          <span><span className="legend-bar" /> ±1σ expected range</span>
          <span><span className="legend-dot" /> Current NIFTY ({fmt(data.currentClose)})</span>
        </div>
      </div>

      {/* ── Strategy recommendations ─────────────────────────────── */}
      <div className="form-card">
        <h3>Suggested Strategies</h3>
        <p className="an-chart-note">
          Primary signal: {data.vix != null ? `India VIX ${data.vix} (${vixMeta?.label})` : `HV ${data.hvUsed}%`}
          {' · '}Trend: {trend.label} ({data.trendPct > 0 ? '+' : ''}{data.trendPct}% over 5 days).
          Strikes rounded to nearest 50. Verify live bid/ask before placing.
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
                {s.strikes && <div className="an-strikes">{s.strikes}</div>}
                <div className="an-strategy-desc">{s.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── AI-powered analysis panel ────────────────────────────── */}
      <AiAnalysisPanel candles={data.candles} />

      <div className="an-disclaimer">
        Rule-based signals use India VIX and historical price data only. AI analysis additionally uses live global markets.
        Neither constitutes financial advice — always verify before trading.
      </div>
    </div>
  );
}
