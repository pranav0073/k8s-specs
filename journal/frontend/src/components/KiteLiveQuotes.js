import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const LOT_SIZE = 65;

function formatUpdatedAt(isoStr) {
  if (!isoStr) return null;
  const d   = new Date(isoStr);
  const now = new Date();
  const diffMs  = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)   return 'just now';
  if (diffMin < 60)  return `${diffMin} min ago`;
  // > 1 hour: show exact time
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function KiteLiveQuotes({ tradeId }) {
  const [status,    setStatus]    = useState(null);  // {configured, authenticated, token_date, api_key_hint}
  const [quotes,    setQuotes]    = useState(null);  // legQuotes array
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [apiKey,    setApiKey]    = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [saving,    setSaving]    = useState(false);

  const fetchStatus = useCallback(() => {
    axios.get('/api/kite/status').then(r => setStatus(r.data)).catch(() => {});
  }, []);

  // On mount: load cached quotes first
  useEffect(() => {
    fetchStatus();
    // Listen for auth callback from popup
    const handler = (e) => { if (e.data === 'kite_auth_success') { fetchStatus(); } };
    window.addEventListener('message', handler);

    // Load cached quotes
    axios.get(`/api/kite/stored-quotes?trade_id=${tradeId}`)
      .then(r => {
        if (r.data.legQuotes && r.data.legQuotes.some(lq => lq.quote)) {
          setQuotes(r.data.legQuotes);
          setUpdatedAt(r.data.updatedAt);
        }
      })
      .catch(() => {}); // silently ignore if no cached data

    return () => window.removeEventListener('message', handler);
  }, [fetchStatus, tradeId]);

  const fetchQuotes = async () => {
    setLoading(true); setError('');
    try {
      const r = await axios.get(`/api/kite/quotes?trade_id=${tradeId}`);
      // Compute client-side pnl for live data
      const legsWithPnl = r.data.legQuotes.map(leg => {
        if (!leg.quote) return leg;
        const sign = leg.side === 'B' ? 1 : -1;
        const pnl  = sign * (leg.quote.ltp - parseFloat(leg.entry_price)) * parseFloat(leg.lots) * LOT_SIZE;
        return { ...leg, pnl };
      });
      setQuotes(legsWithPnl);
      setUpdatedAt(r.data.updatedAt);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to fetch quotes');
    } finally {
      setLoading(false);
    }
  };

  const connectKite = async () => {
    const r = await axios.get('/api/kite/login-url');
    const popup = window.open(r.data.url, 'kite_login', 'width=520,height=620');
    // Poll until popup closes
    const t = setInterval(() => {
      if (popup?.closed) { clearInterval(t); fetchStatus(); }
    }, 800);
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post('/api/kite/configure', { api_key: apiKey, api_secret: apiSecret });
      setShowSetup(false);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const fmt = v => v != null ? Number(v).toFixed(v < 1 && v > -1 ? 4 : 2) : '—';
  const fmtRs = v => v != null ? `₹${Number(v).toFixed(2)}` : '—';

  const netPnl = quotes
    ? quotes.reduce((sum, leg) => sum + (leg.pnl ?? 0), 0)
    : null;

  return (
    <div className="form-card">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontWeight:700, fontSize:15 }}>⚡ Live Market Data</span>
          {status && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
              background: status.authenticated ? '#dcfce7' : '#fee2e2',
              color:      status.authenticated ? '#15803d'  : '#dc2626',
            }}>
              {status.authenticated ? `Connected · ${status.token_date}` : 'Not connected'}
            </span>
          )}
          {updatedAt && (
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              Last refreshed: {formatUpdatedAt(updatedAt)}
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-sm" style={{ fontSize:12, padding:'4px 10px' }}
            onClick={() => setShowSetup(s => !s)}>
            ⚙ Configure
          </button>
          {status?.configured && !status?.authenticated && (
            <button className="btn btn-primary btn-sm" style={{ fontSize:12, padding:'4px 10px' }}
              onClick={connectKite}>
              Connect Zerodha
            </button>
          )}
          {status?.authenticated && (
            <button className="btn btn-primary btn-sm" style={{ fontSize:12, padding:'4px 10px', display:'flex', alignItems:'center', gap:4 }}
              onClick={fetchQuotes} disabled={loading}>
              {loading ? '…' : '↻ Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Setup form */}
      {showSetup && (
        <form onSubmit={saveConfig} style={{ background:'#f9fafb', border:'1px solid #e5e5e5', borderRadius:8, padding:14, marginBottom:12 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Kite Connect API Credentials</div>
          <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
            <input className="form-input" placeholder="API Key" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ flex:1, minWidth:160, fontSize:13 }} />
            <input className="form-input" placeholder="API Secret" type="password" value={apiSecret}
              onChange={e => setApiSecret(e.target.value)}
              style={{ flex:1, minWidth:160, fontSize:13 }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:11, color:'#6b7280' }}>
              Set redirect URL to <code>http://127.0.0.1:5000/api/kite/callback</code> in your Kite developer console.
            </span>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving} style={{ fontSize:12 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {status?.api_key_hint && <div style={{ fontSize:11, color:'#6b7280', marginTop:6 }}>Current key: {status.api_key_hint}</div>}
        </form>
      )}

      {error && <div className="ep-error" style={{ marginBottom:10 }}>{error}</div>}

      {/* Quotes table */}
      {quotes ? (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid #e5e5e5' }}>
                {['Leg','Symbol','LTP','Chg','IV %','Delta','Theta/d','Gamma','Vega','OI','P&L'].map(h => (
                  <th key={h} style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#6b7280', whiteSpace:'nowrap' }}
                    {...(h === 'Leg' ? { style:{ padding:'6px 8px', textAlign:'left', fontWeight:600, color:'#6b7280' } } : {})}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((leg, i) => {
                const q = leg.quote;
                const isBuy = leg.side === 'B';
                const pnl   = leg.pnl ?? null;
                return (
                  <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'8px 8px', fontWeight:600, color: isBuy ? '#2563eb' : '#dc2626' }}>
                      {isBuy ? 'B' : 'S'} {leg.strike} {leg.type}
                    </td>
                    <td style={{ padding:'8px 8px', color:'#6b7280', fontSize:11, textAlign:'right' }}>
                      {leg.symbol || '—'}
                    </td>
                    <td style={{ padding:'8px 8px', textAlign:'right', fontWeight:700 }}>
                      {q ? fmtRs(q.ltp) : '—'}
                    </td>
                    <td style={{ padding:'8px 8px', textAlign:'right',
                      color: q?.change > 0 ? '#16a34a' : q?.change < 0 ? '#dc2626' : '#6b7280' }}>
                      {q?.change != null ? `${q.change > 0 ? '+' : ''}${Number(q.change).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding:'8px 8px', textAlign:'right' }}>{q ? fmt(q.iv) : '—'}</td>
                    <td style={{ padding:'8px 8px', textAlign:'right' }}>{q ? fmt(q.delta) : '—'}</td>
                    <td style={{ padding:'8px 8px', textAlign:'right', color:'#dc2626' }}>{q ? fmt(q.theta) : '—'}</td>
                    <td style={{ padding:'8px 8px', textAlign:'right' }}>{q ? fmt(q.gamma) : '—'}</td>
                    <td style={{ padding:'8px 8px', textAlign:'right' }}>{q ? fmt(q.vega) : '—'}</td>
                    <td style={{ padding:'8px 8px', textAlign:'right', color:'#6b7280' }}>
                      {q?.oi != null ? Number(q.oi).toLocaleString('en-IN') : '—'}
                    </td>
                    <td style={{ padding:'8px 8px', textAlign:'right', fontWeight:600,
                      color: pnl == null ? '#6b7280' : pnl >= 0 ? '#16a34a' : '#dc2626' }}>
                      {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}₹${Math.round(pnl).toLocaleString('en-IN')}`}
                    </td>
                  </tr>
                );
              })}
              {/* Net P&L row */}
              <tr style={{ borderTop:'2px solid #e5e5e5', background:'#f9fafb' }}>
                <td colSpan={10} style={{ padding:'8px 8px', textAlign:'right', fontWeight:700, color:'#374151' }}>
                  Net P&L
                </td>
                <td style={{ padding:'8px 8px', textAlign:'right', fontWeight:700,
                  color: netPnl == null ? '#6b7280' : netPnl >= 0 ? '#16a34a' : '#dc2626' }}>
                  {netPnl == null ? '—' : `${netPnl >= 0 ? '+' : ''}₹${Math.round(netPnl).toLocaleString('en-IN')}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : status?.authenticated ? (
        <div style={{ textAlign:'center', padding:'24px 0', color:'#9ca3af', fontSize:13 }}>
          Click ↻ Refresh to load live quotes
        </div>
      ) : !status?.configured ? (
        <div style={{ textAlign:'center', padding:'24px 0', color:'#9ca3af', fontSize:13 }}>
          Click ⚙ Configure to add your Kite API credentials
        </div>
      ) : (
        <div style={{ textAlign:'center', padding:'24px 0', color:'#9ca3af', fontSize:13 }}>
          Click "Connect Zerodha" to authenticate for today's session
        </div>
      )}
    </div>
  );
}
