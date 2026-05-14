import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
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
  if (!S || !K || !sigma || S <= 0 || K <= 0 || sigma <= 0) {
    return Math.max(0, type === 'CE' ? S - K : K - S);
  }
  if (T <= 0) return Math.max(0, type === 'CE' ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (!isFinite(d1) || !isFinite(d2)) return Math.max(0, type === 'CE' ? S - K : K - S);
  if (type === 'CE') return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

// ── Expiry parsing ────────────────────────────────────────────────────────────
const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function lastTuesdayOfMonth(year, mon) {
  const last = new Date(year, mon + 1, 0);
  const sub  = (last.getDay() - 2 + 7) % 7;
  return new Date(year, mon, last.getDate() - sub);
}

function parseExpiry(str) {
  if (!str) return null;
  const monthly = str.match(/^([A-Za-z]{3})\s*'(\d{2})$/);
  if (monthly) {
    const mon = MONTH_MAP[monthly[1].toLowerCase()];
    return lastTuesdayOfMonth(2000 + parseInt(monthly[2], 10), mon);
  }
  const weekly = str.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (weekly) {
    const day = parseInt(weekly[1], 10);
    const mon = MONTH_MAP[weekly[2].toLowerCase()];
    const now = new Date();
    let d = new Date(now.getFullYear(), mon, day);
    if (d < now) d = new Date(now.getFullYear() + 1, mon, day);
    return d;
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// ── Payoff calculation ────────────────────────────────────────────────────────
function computePayoff(spotVal, dteVal, sigma, legs) {
  const T = Math.max(0, dteVal) / 365;
  let total = 0;
  for (const leg of legs) {
    const K    = parseFloat(leg.strike);
    const type = leg.type;
    if (!K || !type || isNaN(K)) continue;
    const sign  = leg.side === 'B' ? 1 : -1;
    const lots  = leg.lots || 1;
    const entry = leg.entry_price || 0;
    const theor = bsmPrice(spotVal, K, T, sigma, type);
    total += sign * (theor - entry) * lots * LOT_SIZE;
  }
  return isFinite(total) ? total : 0;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function PayoffTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e5e5', borderRadius:8, padding:'8px 12px', fontSize:13 }}>
      <div style={{ fontWeight:600, marginBottom:4 }}>NIFTY {Number(label).toLocaleString('en-IN')}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value >= 0 ? '+' : ''}₹{Math.round(p.value).toLocaleString('en-IN')}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PayoffGraph({ trade }) {
  const legs = useMemo(() => {
    try { return JSON.parse(trade?.legs || '[]'); } catch { return []; }
  }, [trade?.legs]);

  const [spot,    setSpot]    = useState(null);
  const [dte,     setDte]     = useState(0);
  const [maxDte,  setMaxDte]  = useState(30);
  const [ivPct,   setIvPct]   = useState(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trade?.id) return;

    // Compute max DTE from leg expiries
    const expiries = legs.map(l => parseExpiry(l.expiry)).filter(Boolean);
    const maxMs    = expiries.length ? Math.max(...expiries.map(d => d.getTime())) : null;
    const mDte     = maxMs ? Math.max(0, Math.round((maxMs - Date.now()) / 86400000)) : 30;
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
        if (ivs.length) iv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
      }
      if (!s && analysis.status === 'fulfilled') s = analysis.value.data?.currentClose ?? null;
      if (s && isFinite(s))  setSpot(s);
      if (iv && isFinite(iv)) setIvPct(+(iv * 100).toFixed(1));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [trade?.id]); // eslint-disable-line

  const sigma = ivPct / 100;

  const chartData = useMemo(() => {
    if (!spot || !legs.length) return [];
    const range = spot * 0.12;
    const steps = 100;
    const step  = (2 * range) / steps;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const s = Math.round(spot - range + i * step);
      return {
        s,
        atExpiry: +computePayoff(s, 0,   sigma, legs).toFixed(0),
        atDte:    +computePayoff(s, dte,  sigma, legs).toFixed(0),
      };
    });
  }, [spot, dte, sigma, legs]);

  const breakevens = useMemo(() => {
    const pts = [];
    for (let i = 1; i < chartData.length; i++) {
      const a = chartData[i - 1], b = chartData[i];
      if ((a.atExpiry < 0) !== (b.atExpiry < 0)) pts.push(Math.round((a.s + b.s) / 2));
    }
    return pts;
  }, [chartData]);

  if (!legs.length) return null;

  const fmt = n => Number(n).toLocaleString('en-IN');
  const pnlNow    = spot ? computePayoff(spot, dte, sigma, legs) : null;
  const pnlExpiry = spot ? computePayoff(spot, 0,   sigma, legs) : null;

  return (
    <div className="form-card" style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 16 }}>📊 Payoff Graph</h3>

      {loading ? (
        <div className="loading" style={{ padding: 32 }}>Loading…</div>
      ) : !spot ? (
        <div style={{ color:'#888', padding:'24px 0', textAlign:'center' }}>
          Could not load NIFTY spot price. Connect Kite or add sessions data.
        </div>
      ) : (
        <>
          {/* ── Controls ── */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:24, marginBottom:20, alignItems:'flex-end' }}>
            <div style={{ flex:'1 1 220px' }}>
              <label style={{ fontSize:13, fontWeight:600, display:'block', marginBottom:4 }}>
                Days to Expiry: <span style={{ color:'#0d0d0d' }}>{dte}d</span>
              </label>
              <input type="range" min={0} max={maxDte} step={1} value={dte}
                onChange={e => setDte(Number(e.target.value))} style={{ width:'100%' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#888', marginTop:2 }}>
                <span>Expiry (0d)</span><span>Today ({maxDte}d)</span>
              </div>
            </div>

            <div style={{ flex:'1 1 180px' }}>
              <label style={{ fontSize:13, fontWeight:600, display:'block', marginBottom:4 }}>
                IV: <span style={{ color:'#0d0d0d' }}>{ivPct}%</span>
              </label>
              <input type="range" min={5} max={80} step={0.5} value={ivPct}
                onChange={e => setIvPct(Number(e.target.value))} style={{ width:'100%' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#888', marginTop:2 }}>
                <span>5%</span><span>80%</span>
              </div>
            </div>

            <div style={{ fontSize:13, color:'#555', minWidth:160 }}>
              <div>NIFTY Spot: <strong>{fmt(Math.round(spot))}</strong></div>
              {pnlNow != null && (
                <div style={{ marginTop:2 }}>
                  At {dte}d:{' '}
                  <strong style={{ color: pnlNow >= 0 ? '#16a34a' : '#dc2626' }}>
                    {pnlNow >= 0 ? '+' : ''}₹{fmt(Math.round(pnlNow))}
                  </strong>
                </div>
              )}
              {pnlExpiry != null && (
                <div style={{ marginTop:2 }}>
                  At expiry:{' '}
                  <strong style={{ color: pnlExpiry >= 0 ? '#16a34a' : '#dc2626' }}>
                    {pnlExpiry >= 0 ? '+' : ''}₹{fmt(Math.round(pnlExpiry))}
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* ── Chart ── */}
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top:10, right:20, left:10, bottom:10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="s" tickFormatter={v => fmt(v)} tick={{ fontSize:11 }}
                label={{ value:'NIFTY Spot', position:'insideBottomRight', offset:-10, fontSize:12 }} />
              <YAxis tickFormatter={v => `₹${v < 0 ? '-' : ''}${fmt(Math.abs(v))}`}
                tick={{ fontSize:11 }} width={90} />
              <Tooltip content={<PayoffTooltip />} />
              <Legend verticalAlign="top" height={32} />
              <ReferenceLine y={0} stroke="#999" strokeWidth={1.5} strokeDasharray="4 2" />
              <ReferenceLine x={Math.round(spot)} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 2"
                label={{ value:'Spot', position:'top', fontSize:11, fill:'#2563eb' }} />
              {breakevens.map(be => (
                <ReferenceLine key={be} x={be} stroke="#d97706" strokeWidth={1}
                  label={{ value:`BE ${fmt(be)}`, position:'insideTopRight', fontSize:10, fill:'#d97706' }} />
              ))}
              <Line type="monotone" dataKey="atExpiry" name="At Expiry"
                stroke="#6b7280" strokeWidth={1.5} strokeDasharray="5 3" dot={false} activeDot={{ r:4 }} />
              <Line type="monotone" dataKey="atDte" name={`At ${dte}d`}
                stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r:5 }} />
            </LineChart>
          </ResponsiveContainer>

          {breakevens.length > 0 && (
            <div style={{ fontSize:12, color:'#d97706', textAlign:'center', marginTop:4 }}>
              Breakeven at expiry: {breakevens.map(be => fmt(be)).join(' / ')}
            </div>
          )}
          <div style={{ fontSize:11, color:'#aaa', textAlign:'center', marginTop:8 }}>
            Theoretical P&L · Black-Scholes · Lot size {LOT_SIZE} · Not financial advice
          </div>
        </>
      )}
    </div>
  );
}
