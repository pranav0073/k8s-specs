import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import ImageUpload from './ImageUpload';

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
}

function fmtDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function pctChange(close, prevClose) {
  if (!close || !prevClose) return null;
  return ((close - prevClose) / prevClose * 100).toFixed(2);
}

const EMPTY_FORM = { open: '', high: '', low: '', close: '', prev_close: '', notes: '' };

export default function MarketDiary() {
  const [sessions, setSessions]         = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sessionData, setSessionData]   = useState(null);
  const [activeTrades, setActiveTrades] = useState([]);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [fetching, setFetching]         = useState(false);
  const [fetchErr, setFetchErr]         = useState('');

  const loadSessions = useCallback(() => {
    axios.get('/api/sessions').then(r => setSessions(r.data));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (!selectedDate) return;
    setSessionData(null);
    setActiveTrades([]);
    setForm(EMPTY_FORM);

    axios.get(`/api/sessions/${selectedDate}`)
      .then(r => {
        setSessionData(r.data);
        setForm({
          open:       r.data.open       ?? '',
          high:       r.data.high       ?? '',
          low:        r.data.low        ?? '',
          close:      r.data.close      ?? '',
          prev_close: r.data.prev_close ?? '',
          notes:      r.data.notes      ?? '',
        });
      })
      .catch(() => {});

    axios.get(`/api/sessions/${selectedDate}/active-trades`)
      .then(r => setActiveTrades(r.data))
      .catch(() => {});
  }, [selectedDate]);

  const today = localDateStr();

  const handleAddToday = () => setSelectedDate(today);

  const handleFetch = async () => {
    if (!selectedDate) return;
    setFetching(true);
    setFetchErr('');
    try {
      const r = await axios.get('/api/sessions/quote', { params: { date: selectedDate } });
      setForm(f => ({
        ...f,
        open:       r.data.open       ?? f.open,
        high:       r.data.high       ?? f.high,
        low:        r.data.low        ?? f.low,
        close:      r.data.close      ?? f.close,
        prev_close: r.data.prev_close ?? f.prev_close,
      }));
    } catch (e) {
      setFetchErr(e.response?.data?.error || 'Failed to fetch NIFTY data');
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await axios.post('/api/sessions', { date: selectedDate, ...form });
      loadSessions();
      // refresh session data
      axios.get(`/api/sessions/${selectedDate}`).then(r => setSessionData(r.data)).catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const pct = pctChange(sessionData?.close, sessionData?.prev_close);

  return (
    <div className="diary-layout">
      {/* ── Left: session list ───────────────────── */}
      <div className="diary-sidebar">
        <div className="diary-sidebar-header">
          <span className="diary-sidebar-title">Market Sessions</span>
          <button className="btn btn-primary btn-sm" onClick={handleAddToday}>+ Today</button>
        </div>

        <div className="diary-session-list">
          {sessions.length === 0 && (
            <div className="diary-empty-hint">No sessions yet.<br />Click "+ Today" to start.</div>
          )}
          {sessions.map(s => {
            const p = pctChange(s.close, s.prev_close);
            const isPos = p !== null && Number(p) >= 0;
            return (
              <button
                key={s.id}
                className={`diary-session-item${selectedDate === s.date ? ' selected' : ''}`}
                onClick={() => setSelectedDate(s.date)}
              >
                <div className="dsi-date">{fmtDateShort(s.date)}</div>
                <div className="dsi-right">
                  {s.close ? (
                    <>
                      <span className="dsi-close">{s.close.toLocaleString('en-IN')}</span>
                      {p !== null && (
                        <span className={`dsi-pct ${isPos ? 'pos' : 'neg'}`}>
                          {isPos ? '▲' : '▼'}{Math.abs(p)}%
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="dsi-no-data">No data</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: session detail ────────────────── */}
      <div className="diary-main">
        {!selectedDate ? (
          <div className="diary-placeholder">
            <div className="diary-placeholder-icon">📅</div>
            <div className="diary-placeholder-text">Select a session from the left, or add today's session</div>
          </div>
        ) : (
          <>
            <div className="diary-detail-header">
              <div>
                <h2 className="diary-detail-date">{fmtDate(selectedDate)}</h2>
                {sessionData && (
                  <div className="diary-ohlc-summary">
                    {sessionData.open  != null && <span>O <b>{sessionData.open.toLocaleString('en-IN')}</b></span>}
                    {sessionData.high  != null && <span>H <b className="pos">{sessionData.high.toLocaleString('en-IN')}</b></span>}
                    {sessionData.low   != null && <span>L <b className="neg">{sessionData.low.toLocaleString('en-IN')}</b></span>}
                    {sessionData.close != null && <span>C <b>{sessionData.close.toLocaleString('en-IN')}</b></span>}
                  </div>
                )}
              </div>
              {pct !== null && (
                <div className={`diary-pct-pill ${Number(pct) >= 0 ? 'pos' : 'neg'}`}>
                  {Number(pct) >= 0 ? '▲' : '▼'} {Math.abs(pct)}%
                </div>
              )}
            </div>

            {/* NIFTY OHLC entry */}
            <div className="form-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>NIFTY Data</h3>
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={handleFetch}
                  disabled={fetching}
                  title="Auto-fill OHLC from NSE via Yahoo Finance"
                >
                  {fetching ? 'Fetching…' : '⟳ Fetch from NSE'}
                </button>
              </div>
              {fetchErr && (
                <div style={{ fontSize: 12, color: 'var(--red)', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
                  {fetchErr}
                </div>
              )}
              <div className="ohlc-row">
                {[
                  { key: 'prev_close', label: 'Prev Close' },
                  { key: 'open',       label: 'Open' },
                  { key: 'high',       label: 'High' },
                  { key: 'low',        label: 'Low' },
                  { key: 'close',      label: 'Close' },
                ].map(({ key, label }) => (
                  <div key={key} className="ohlc-field">
                    <label>{label}</label>
                    <input
                      type="number"
                      step="0.05"
                      value={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="—"
                    />
                  </div>
                ))}
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Session Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Market observations, news, key NIFTY levels, VIX…"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Session'}
                </button>
                {saved && <span className="save-ok">✓ Saved</span>}
              </div>

              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
                  Chart Screenshots
                </label>
                <ImageUpload
                  images={sessionData?.images || []}
                  uploadUrl={`/api/sessions/${selectedDate}/images`}
                  deleteUrlFn={fname => `/api/sessions/${selectedDate}/images/${fname}`}
                  onImagesChange={() =>
                    axios.get(`/api/sessions/${selectedDate}`)
                      .then(r => setSessionData(r.data))
                      .catch(() => {})
                  }
                />
              </div>
            </div>

            {/* Active trades */}
            <div className="form-card">
              <h3>Active Trades on this Day ({activeTrades.length})</h3>
              {activeTrades.length === 0 ? (
                <div className="diary-empty-hint" style={{ padding: '12px 0' }}>
                  No trades active on this date.
                </div>
              ) : (
                <div className="active-trades-list">
                  {activeTrades.map(t => {
                    const isOpen = t.status === 'open';
                    return (
                      <Link key={t.id} to={`/trades/${t.id}`} className="active-trade-item">
                        <div className="ati-left">
                          <span className="ati-instrument">{t.instrument}</span>
                          <span className="ati-strategy">{t.strategy || '—'}</span>
                          <span className="ati-date">Entry {t.date}</span>
                        </div>
                        <div className="ati-right">
                          <span className={`status-badge ${t.status}`}>{t.status}</span>
                          {isOpen && <span className="ati-arrow">→</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
