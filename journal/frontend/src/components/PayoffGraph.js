import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer, Legend,
} from 'recharts';

const LOT_SIZE = 65;

// ── Black-Scholes ─────────────────────────────────────────────────────────────
function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x) / Math.sqrt(2));
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2);
  return 0.5 * (1 + sign * y);
}
function normPDF(x) { return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI); }

function bsmPrice(S, K, T, sigma, type, r=0.065) {
  if (!S || !K || !sigma || S <= 0 || K <= 0 || sigma <= 0) return Math.max(0, type === 'CE' ? S-K : K-S);
  if (T <= 0) return Math.max(0, type === 'CE' ? S-K : K-S);
  const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
  const d2 = d1 - sigma*Math.sqrt(T);
  if (!isFinite(d1)) return Math.max(0, type === 'CE' ? S-K : K-S);
  if (type === 'CE') return S*normCDF(d1) - K*Math.exp(-r*T)*normCDF(d2);
  return K*Math.exp(-r*T)*normCDF(-d2) - S*normCDF(-d1);
}

// ── Expiry parsing ────────────────────────────────────────────────────────────
const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function lastTuesdayOfMonth(year, mon) {
  const last = new Date(year, mon + 1, 0);
  return new Date(year, mon, last.getDate() - (last.getDay() - 2 + 7) % 7);
}

function parseExpiry(str) {
  if (!str) return null;
  const m = str.match(/^([A-Za-z]{3})\s*'(\d{2})$/);
  if (m) return lastTuesdayOfMonth(2000 + parseInt(m[2], 10), MONTH_MAP[m[1].toLowerCase()]);
  const w = str.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (w) {
    const day = parseInt(w[1], 10), mon = MONTH_MAP[w[2].toLowerCase()];
    const now = new Date();
    let d = new Date(now.getFullYear(), mon, day);
    if (d < now) d = new Date(now.getFullYear() + 1, mon, day);
    return d;
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// ── Payoff & metrics ──────────────────────────────────────────────────────────
function computePayoff(spotVal, dteVal, sigma, legs) {
  const T = Math.max(0, dteVal) / 365;
  let total = 0;
  for (const leg of legs) {
    const K = parseFloat(leg.strike);
    if (!K || !leg.type || isNaN(K)) continue;
    const sign  = leg.side === 'B' ? 1 : -1;
    const theor = bsmPrice(spotVal, K, T, sigma, leg.type);
    total += sign * (theor - (leg.entry_price || 0)) * (leg.lots || 1) * LOT_SIZE;
  }
  return isFinite(total) ? total : 0;
}

function computePOP(chartData, spot, sigma, T) {
  if (T <= 0 || !spot || !sigma || chartData.length < 2) return null;
  let pop = 0;
  for (let i = 1; i < chartData.length; i++) {
    if (chartData[i].atExpiry > 0) {
      const s1 = chartData[i-1].s, s2 = chartData[i].s;
      const drift = -0.5 * sigma * sigma * T;
      const d2 = (Math.log(s2/spot) - drift) / (sigma * Math.sqrt(T));
      const d1 = (Math.log(s1/spot) - drift) / (sigma * Math.sqrt(T));
      pop += normCDF(d2) - normCDF(d1);
    }
  }
  return Math.min(99, Math.max(1, Math.round(pop * 100)));
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtRs = (v, showSign=false) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = showSign ? (v >= 0 ? '+' : '-') : (v < 0 ? '-' : '');
  if (abs >= 100000) return `${sign}₹${(abs/100000).toFixed(2)}L`;
  if (abs >= 1000)   return `${sign}₹${(abs/1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
};
const fmtY = v => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100000) return `${sign}₹${(abs/100000).toFixed(1)}L`;
  if (abs >= 1000)   return `${sign}₹${(abs/1000).toFixed(0)}K`;
  return `${sign}₹${abs}`;
};
const fmtSpot = v => Number(v).toLocaleString('en-IN');

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, color, sub }) {
  return (
    <div style={{ flex:1, padding:'14px 16px', borderRight:'1px solid #f0f0f0', minWidth:0 }}>
      <div style={{ fontSize:11, color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:700, color: color || '#0d0d0d', whiteSpace:'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, dte }) {
  if (!active || !payload?.length) return null;
  const expiry = payload.find(p => p.dataKey === 'atExpiry')?.value;
  const atDte  = payload.find(p => p.dataKey === 'atDte')?.value;
  return (
    <div style={{ background:'#1e293b', color:'#fff', borderRadius:10, padding:'10px 14px', fontSize:12, boxShadow:'0 8px 24px rgba(0,0,0,0.25)', minWidth:160 }}>
      <div style={{ fontWeight:700, marginBottom:8, color:'#94a3b8', fontSize:11 }}>
        NIFTY {fmtSpot(Math.round(label))}
      </div>
      <div style={{ display:'flex', gap:20 }}>
        {expiry != null && (
          <div>
            <div style={{ color:'#94a3b8', fontSize:10, marginBottom:2 }}>At Expiry</div>
            <div style={{ fontWeight:700, fontSize:14, color: expiry >= 0 ? '#4ade80' : '#f87171' }}>
              {fmtRs(expiry, true)}
            </div>
          </div>
        )}
        {atDte != null && (
          <div>
            <div style={{ color:'#94a3b8', fontSize:10, marginBottom:2 }}>At {dte}d</div>
            <div style={{ fontWeight:700, fontSize:14, color: atDte >= 0 ? '#60a5fa' : '#f87171' }}>
              {fmtRs(atDte, true)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Custom legend ─────────────────────────────────────────────────────────────
function ChartLegend({ dte, hasDraft }) {
  return (
    <div style={{ display:'flex', gap:16, justifyContent:'center', paddingTop:4, fontSize:12, flexWrap:'wrap' }}>
      {hasDraft && (
        <>
          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#d97706" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
            Current (expiry)
          </span>
          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#d97706" strokeWidth="2"/></svg>
            Current ({dte}d)
          </span>
        </>
      )}
      <span style={{ display:'flex', alignItems:'center', gap:5 }}>
        <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#9ca3af" strokeWidth="2" strokeDasharray="5 3"/></svg>
        {hasDraft ? 'Combined (expiry)' : 'At Expiry'}
      </span>
      <span style={{ display:'flex', alignItems:'center', gap:5 }}>
        <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#2563eb" strokeWidth="2.5"/></svg>
        {hasDraft ? `Combined (${dte}d)` : `At ${dte}d`}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PayoffGraph({ trade, extraLegs }) {
  const legs = useMemo(() => {
    const raw = trade?.legs;
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  }, [trade?.legs]);

  const [spot,    setSpot]    = useState(null);
  const [dte,     setDte]     = useState(0);
  const [maxDte,  setMaxDte]  = useState(30);
  const [ivPct,   setIvPct]   = useState(15);
  const [showSD,  setShowSD]  = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trade?.id) return;
    const expiries = legs.map(l => parseExpiry(l.expiry)).filter(Boolean);
    const maxMs = expiries.length ? Math.max(...expiries.map(d => d.getTime())) : null;
    const mDte  = maxMs ? Math.max(0, Math.round((maxMs - Date.now()) / 86400000)) : 30;
    setMaxDte(mDte);
    setDte(mDte);

    Promise.allSettled([
      axios.get(`/api/kite/quotes?trade_id=${trade.id}`),
      axios.get('/api/sessions/analysis'),
    ]).then(([kite, analysis]) => {
      let s = null, iv = null;
      if (kite.status === 'fulfilled') {
        s  = kite.value.data?.niftySpot ?? null;
        const ivs = (kite.value.data?.legQuotes || []).map(l => l.quote?.iv).filter(v => v && isFinite(v));
        if (ivs.length) iv = ivs.reduce((a,b) => a+b,0) / ivs.length;
      }
      if (!s && analysis.status === 'fulfilled') s = analysis.value.data?.currentClose ?? null;
      if (s && isFinite(s))  setSpot(s);
      if (iv && isFinite(iv)) setIvPct(+(iv * 100).toFixed(2));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [trade?.id]); // eslint-disable-line

  const sigma = ivPct / 100;

  const allLegs = useMemo(() => {
    if (!extraLegs?.length) return legs;
    return [...legs, ...extraLegs];
  }, [legs, extraLegs]);

  const hasDraft = extraLegs?.length > 0;

  const chartData = useMemo(() => {
    if (!spot || !allLegs.length) return [];
    const range = spot * 0.14;
    const steps = 120;
    const step  = (2 * range) / steps;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const s   = Math.round(spot - range + i * step);
      const row = {
        s,
        atExpiry: +computePayoff(s, 0,  sigma, allLegs).toFixed(0),
        atDte:    +computePayoff(s, dte, sigma, allLegs).toFixed(0),
      };
      if (hasDraft && legs.length) {
        row.origAtExpiry = +computePayoff(s, 0,  sigma, legs).toFixed(0);
        row.origAtDte    = +computePayoff(s, dte, sigma, legs).toFixed(0);
      }
      return row;
    });
  }, [spot, dte, sigma, allLegs, legs, hasDraft]);

  // ── Derived metrics ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!chartData.length) return null;
    const expiryVals = chartData.map(d => d.atExpiry);
    const maxProfit  = Math.max(...expiryVals);
    const maxLoss    = Math.min(...expiryVals);
    const rr         = maxLoss !== 0 ? Math.abs(maxProfit / maxLoss).toFixed(1) : '∞';
    const T          = dte / 365;
    const pop        = computePOP(chartData, spot, sigma, T);
    const pnlNow     = spot ? computePayoff(spot, dte,  sigma, allLegs) : null;
    const pnlExpiry  = spot ? computePayoff(spot, 0,    sigma, allLegs) : null;
    return { maxProfit, maxLoss, rr, pop, pnlNow, pnlExpiry };
  }, [chartData, spot, dte, sigma, allLegs]);

  // ── Breakevens ───────────────────────────────────────────────────────────
  const breakevens = useMemo(() => {
    const pts = [];
    for (let i = 1; i < chartData.length; i++) {
      const a = chartData[i-1], b = chartData[i];
      if ((a.atExpiry < 0) !== (b.atExpiry < 0)) pts.push(Math.round((a.s + b.s) / 2));
    }
    return pts;
  }, [chartData]);

  // ── Profit/loss shading zones ────────────────────────────────────────────
  const zones = useMemo(() => {
    if (!chartData.length) return [];
    const result = [];
    let zStart = chartData[0].s;
    let isProfit = chartData[0].atExpiry >= 0;
    for (let i = 1; i < chartData.length; i++) {
      const profit = chartData[i].atExpiry >= 0;
      if (profit !== isProfit) {
        result.push({ x1: zStart, x2: chartData[i].s, profit: isProfit });
        zStart = chartData[i].s;
        isProfit = profit;
      }
    }
    result.push({ x1: zStart, x2: chartData[chartData.length-1].s, profit: isProfit });
    return result;
  }, [chartData]);

  // ── SD markers ───────────────────────────────────────────────────────────
  const sdMarkers = useMemo(() => {
    if (!spot || !ivPct || !dte) return [];
    const sd = spot * (ivPct/100) * Math.sqrt(dte/365);
    return [
      { x: Math.round(spot - 2*sd), label: '-2SD' },
      { x: Math.round(spot - sd),   label: '-1SD' },
      { x: Math.round(spot + sd),   label: '+1SD' },
      { x: Math.round(spot + 2*sd), label: '+2SD' },
    ];
  }, [spot, ivPct, dte]);

  if (!legs.length) return null;

  return (
    <div className="form-card" style={{ padding:0, overflow:'hidden', marginTop:16 }}>

      {/* ── Section title ── */}
      <div style={{ padding:'12px 16px 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontWeight:700, fontSize:14 }}>📊 Payoff Graph</span>
        {loading && <span style={{ fontSize:12, color:'#9ca3af' }}>Loading…</span>}
      </div>

      {/* ── Metrics bar ── */}
      {metrics && (
        <div style={{ display:'flex', borderTop:'1px solid #f0f0f0', borderBottom:'1px solid #f0f0f0', marginTop:12 }}>
          <MetricCard
            label="Max Profit"
            value={fmtRs(metrics.maxProfit, true)}
            color={metrics.maxProfit > 0 ? '#16a34a' : '#dc2626'}
          />
          <MetricCard
            label="Max Loss"
            value={fmtRs(metrics.maxLoss, true)}
            color={metrics.maxLoss < 0 ? '#dc2626' : '#16a34a'}
          />
          <MetricCard
            label="Breakeven"
            value={breakevens.length ? breakevens.map(b => fmtSpot(b)).join(' / ') : '—'}
            color="#d97706"
          />
          <MetricCard
            label="Risk / Reward"
            value={`${metrics.rr}×`}
            color="#6b7280"
          />
          <MetricCard
            label="POP (est)"
            value={metrics.pop != null ? `${metrics.pop}%` : '—'}
            color="#2563eb"
            sub="at expiry"
          />
        </div>
      )}

      {/* ── Chart + controls ── */}
      {!loading && !spot ? (
        <div style={{ padding:32, textAlign:'center', color:'#9ca3af', fontSize:13 }}>
          Connect Kite or add session data to load NIFTY spot price.
        </div>
      ) : !loading && (
        <div style={{ display:'flex', gap:0 }}>

          {/* Chart */}
          <div style={{ flex:1, padding:'16px 0 8px 0', minWidth:0 }}>
            <ChartLegend dte={dte} hasDraft={hasDraft} />
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top:8, right:16, left:0, bottom:8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />

                {/* Profit / loss shading */}
                {zones.map((z, i) => (
                  <ReferenceArea key={i} x1={z.x1} x2={z.x2}
                    fill={z.profit ? '#dcfce7' : '#fee2e2'} fillOpacity={0.5} strokeOpacity={0} />
                ))}

                {/* SD zone lines */}
                {showSD && sdMarkers.map(sd => (
                  <ReferenceLine key={sd.label} x={sd.x} stroke="#c084fc"
                    strokeDasharray="3 3" strokeWidth={1}
                    label={{ value: sd.label, position:'insideTopRight', fontSize:9, fill:'#a855f7' }} />
                ))}

                {/* Zero line */}
                <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1.5} />

                {/* Current spot */}
                {spot && (
                  <ReferenceLine x={Math.round(spot)} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 2"
                    label={{ value:'Spot', position:'top', fontSize:10, fill:'#2563eb' }} />
                )}

                {/* Breakevens */}
                {breakevens.map(be => (
                  <ReferenceLine key={be} x={be} stroke="#d97706" strokeWidth={1} strokeDasharray="3 2"
                    label={{ value:`BE`, position:'insideTopLeft', fontSize:9, fill:'#d97706' }} />
                ))}

                <XAxis dataKey="s" tickFormatter={fmtSpot} tick={{ fontSize:10 }} tickLine={false}
                  axisLine={{ stroke:'#e5e5e5' }} interval="preserveStartEnd" tickCount={8} />
                <YAxis tickFormatter={fmtY} tick={{ fontSize:10 }} tickLine={false}
                  axisLine={false} width={72} />
                <Tooltip content={<ChartTooltip dte={dte} />} />

                {/* Original position lines (only when draft legs present) */}
                {hasDraft && (
                  <Line type="monotone" dataKey="origAtExpiry" name="Current (expiry)"
                    stroke="#d97706" strokeWidth={1.5} strokeDasharray="5 3" dot={false} activeDot={false} />
                )}
                {hasDraft && (
                  <Line type="monotone" dataKey="origAtDte" name={`Current (${dte}d)`}
                    stroke="#d97706" strokeWidth={2} dot={false} activeDot={false} />
                )}

                <Line type="monotone" dataKey="atExpiry" name={hasDraft ? 'Combined (expiry)' : 'At Expiry'}
                  stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" dot={false} activeDot={false} />
                <Line type="monotone" dataKey="atDte" name={hasDraft ? `Combined (${dte}d)` : `At ${dte}d`}
                  stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r:5, fill:'#2563eb' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Controls panel */}
          <div style={{ width:200, borderLeft:'1px solid #f0f0f0', padding:'16px 16px', display:'flex', flexDirection:'column', gap:20, flexShrink:0 }}>

            {/* DTE slider */}
            <div>
              <div style={{ fontSize:12, fontWeight:600, marginBottom:6, display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#6b7280' }}>Days to Expiry</span>
                <span style={{ color:'#0d0d0d' }}>{dte}d</span>
              </div>
              <input type="range" min={0} max={maxDte} step={1} value={dte}
                onChange={e => setDte(Number(e.target.value))} style={{ width:'100%', accentColor:'#2563eb' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9ca3af', marginTop:2 }}>
                <span>Expiry</span><span>Today</span>
              </div>
            </div>

            {/* IV slider */}
            <div>
              <div style={{ fontSize:12, fontWeight:600, marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#6b7280' }}>IV</span>
                <input
                  type="number" min={5} max={80} step={0.01} value={ivPct}
                  onChange={e => setIvPct(Math.min(80, Math.max(5, Number(e.target.value))))}
                  style={{ width:60, fontSize:12, fontWeight:700, textAlign:'right', border:'1px solid #e5e5e5', borderRadius:4, padding:'1px 4px' }}
                />
              </div>
              <input type="range" min={5} max={80} step={0.1} value={ivPct}
                onChange={e => setIvPct(Number(e.target.value))} style={{ width:'100%', accentColor:'#7c3aed' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9ca3af', marginTop:2 }}>
                <span>5%</span><span>80%</span>
              </div>
            </div>

            {/* SD toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" id="sdToggle" checked={showSD} onChange={e => setShowSD(e.target.checked)}
                style={{ accentColor:'#a855f7', width:14, height:14 }} />
              <label htmlFor="sdToggle" style={{ fontSize:12, color:'#6b7280', cursor:'pointer' }}>
                Show SD zones
              </label>
            </div>

            {/* P&L at spot */}
            {spot && metrics && (
              <div style={{ background:'#f9fafb', borderRadius:8, padding:'10px 12px', marginTop:'auto' }}>
                <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:6, textTransform:'uppercase' }}>
                  At NIFTY {fmtSpot(Math.round(spot))}
                </div>
                <div style={{ fontSize:12, marginBottom:4 }}>
                  <span style={{ color:'#6b7280' }}>At {dte}d: </span>
                  <span style={{ fontWeight:700, color: metrics.pnlNow >= 0 ? '#16a34a' : '#dc2626' }}>
                    {fmtRs(metrics.pnlNow, true)}
                  </span>
                </div>
                <div style={{ fontSize:12 }}>
                  <span style={{ color:'#6b7280' }}>Expiry: </span>
                  <span style={{ fontWeight:700, color: metrics.pnlExpiry >= 0 ? '#16a34a' : '#dc2626' }}>
                    {fmtRs(metrics.pnlExpiry, true)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding:'6px 16px 10px', fontSize:10, color:'#d1d5db', textAlign:'center' }}>
        Theoretical P&L · Black-Scholes · Lot size {LOT_SIZE} · Not financial advice
      </div>
    </div>
  );
}
