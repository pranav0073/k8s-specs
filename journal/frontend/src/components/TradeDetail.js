import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import ImageUpload from './ImageUpload';
import AutoTextarea from './AutoTextarea';

// ── AI Exit Plan panel ────────────────────────────────────────────────────────

const SECTION_META = {
  'Outlook':                    { icon: '📊', cls: 'ep-outlook',  label: 'Outlook' },
  'Profit Target':              { icon: '🎯', cls: 'ep-target',   label: 'Profit Target' },
  'Stop Loss':                  { icon: '🛑', cls: 'ep-stop',     label: 'Stop Loss' },
  'Time-based Rules':           { icon: '⏱',  cls: 'ep-time',     label: 'Time Rules' },
  'If Market Moves Against You':{ icon: '⚠️', cls: 'ep-adjust',   label: 'Adjustment' },
  'Key Levels to Watch':        { icon: '📍', cls: 'ep-levels',   label: 'Key Levels' },
  'Risk Rating':                { icon: '⚡', cls: 'ep-risk',     label: 'Risk' },
};

function ExitPlan({ tradeId }) {
  const [plan,      setPlan]      = useState(null);
  const [planAt,    setPlanAt]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [generating,setGenerating]= useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    axios.get(`/api/trades/${tradeId}/exit-plan`)
      .then(r => { setPlan(r.data.exit_plan); setPlanAt(r.data.exit_plan_at); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tradeId]);

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const r = await axios.post(`/api/trades/${tradeId}/exit-plan`);
      setPlan(r.data.exit_plan);
      setPlanAt(r.data.exit_plan_at);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to generate exit plan');
    } finally {
      setGenerating(false);
    }
  };

  function parseSections(text) {
    return text.split(/^## /m).filter(Boolean).map(sec => {
      const nl    = sec.indexOf('\n');
      const title = nl === -1 ? sec.trim() : sec.slice(0, nl).trim();
      const body  = nl === -1 ? '' : sec.slice(nl + 1).trim();
      const meta  = SECTION_META[title] || { icon: '•', cls: '', label: title };
      return { title, body, meta };
    });
  }

  if (loading) return <div className="loading" style={{ padding: 32 }}>Loading…</div>;

  return (
    <div className="ep-panel">
      <div className="ep-header">
        <div>
          <div className="ep-title">AI Exit Plan</div>
          {planAt && (
            <div className="ep-timestamp">
              Last generated: {new Date(planAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={generate}
          disabled={generating}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {generating ? (
            <><span className="ep-spinner" /> Analysing…</>
          ) : plan ? (
            '↻ Refresh Plan'
          ) : (
            '✦ Generate Exit Plan'
          )}
        </button>
      </div>

      {error && <div className="ep-error">{error}</div>}

      {!plan && !generating && (
        <div className="ep-empty">
          <div className="ep-empty-icon">✦</div>
          <div>Click <strong>Generate Exit Plan</strong> to get an AI-assisted exit strategy based on live NIFTY, India VIX, global markets, and candlestick patterns.</div>
        </div>
      )}

      {generating && (
        <div className="ep-generating">
          <div className="ep-gen-row"><span className="ep-spinner-lg" /> Fetching live market data…</div>
          <div className="ep-gen-hint">Pulling NIFTY spot, India VIX, S&amp;P 500, crude oil, DXY and recent candle patterns</div>
        </div>
      )}

      {plan && !generating && (
        <div className="ep-sections">
          {parseSections(plan).map((sec, i) => (
            <div key={i} className={`ep-section ${sec.meta.cls}`}>
              <div className="ep-section-title">
                <span className="ep-section-icon">{sec.meta.icon}</span>
                {sec.meta.label}
              </div>
              <div className="ep-section-body ep-md">
                <ReactMarkdown>{sec.body}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {plan && (
        <div className="ep-disclaimer">
          AI analysis uses live market data and stored sessions. Not financial advice — verify before acting.
        </div>
      )}
    </div>
  );
}

const LOT_SIZE = 65;

const EMOTIONS = [
  { key: 'confident', label: 'Confident', emoji: '😊' },
  { key: 'anxious',   label: 'Anxious',   emoji: '😟' },
  { key: 'patient',   label: 'Patient',   emoji: '😌' },
  { key: 'fomo',      label: 'FOMO',      emoji: '😰' },
  { key: 'greedy',    label: 'Greedy',    emoji: '🤑' },
  { key: 'relieved',  label: 'Relieved',  emoji: '😅' },
];

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

// Returns YYYY-MM-DD in local timezone (avoids UTC shift for IST/similar zones)
function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(a, b) {
  const msA = new Date(a + 'T00:00:00').getTime();
  const msB = new Date(b + 'T00:00:00').getTime();
  return Math.round((msB - msA) / 86400000);
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate + 'T00:00:00');
  const end   = new Date(endDate   + 'T00:00:00');
  let cur = new Date(start);
  while (cur <= end && dates.length < 120) {
    dates.push(localDateStr(cur)); // local date, not UTC
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function calcNetPremium(legs) {
  return legs.reduce((sum, l) => {
    const mult = l.side === 'B' ? 1 : -1;
    return sum + (l.entry_price || 0) * LOT_SIZE * (l.lots || 1) * mult;
  }, 0);
}

function calcPnl(legs) {
  return legs.reduce((sum, l) => {
    if (l.exit_price == null) return sum;
    const mult = l.side === 'B' ? 1 : -1;
    return sum + (l.exit_price - l.entry_price) * LOT_SIZE * (l.lots || 1) * mult;
  }, 0);
}

// ── Timeline Row ──────────────────────────────────────────────────────────────
function TimelineRow({ date, marker, session, comment: initComment, onSave, tradeId, onImagesChange }) {
  const [comment, setComment] = useState(initComment?.comment || '');
  const [emotion, setEmotion] = useState(initComment?.emotion || '');
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);

  // sync when parent reloads comments
  useEffect(() => {
    setComment(initComment?.comment || '');
    setEmotion(initComment?.emotion || '');
  }, [initComment]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(date, comment, emotion);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const pct = session?.prev_close && session?.close
    ? ((session.close - session.prev_close) / session.prev_close * 100).toFixed(2)
    : null;

  const rangeSpan = session?.high && session?.low
    ? session.high - session.low
    : null;

  const markerClass = marker === 'ENTRY' ? 'marker-entry'
    : marker === 'EXIT' ? 'marker-exit' : 'marker-active';

  return (
    <div className="timeline-row">
      {/* Date + marker */}
      <div className="tl-date-col">
        <div className="tl-date-label">{fmtDateShort(date)}</div>
        <div className={`tl-marker ${markerClass}`}>{marker}</div>
      </div>

      {/* NIFTY data */}
      <div className="tl-nifty-col">
        {session ? (
          <div className="tl-nifty-data">
            <div className="tl-nifty-close">
              <span className="tl-close-val">{session.close?.toLocaleString('en-IN') || '—'}</span>
              {pct !== null && (
                <span className={`tl-pct ${Number(pct) >= 0 ? 'pos' : 'neg'}`}>
                  {Number(pct) >= 0 ? '▲' : '▼'}{Math.abs(pct)}%
                </span>
              )}
            </div>
            <div className="tl-ohlc-mini">
              O:{session.open?.toLocaleString('en-IN') || '—'}
              &nbsp;H:{session.high?.toLocaleString('en-IN') || '—'}
              &nbsp;L:{session.low?.toLocaleString('en-IN') || '—'}
            </div>
            {rangeSpan != null && (
              <div className="tl-range-wrap">
                <div className="tl-range-bar">
                  <div className="tl-range-fill" style={{ width: `${Math.min(100, (rangeSpan / 300) * 100)}%` }} />
                </div>
                <span className="tl-range-label">Range: {rangeSpan.toFixed(0)} pts</span>
              </div>
            )}
            {session.notes && <div className="tl-session-note">💬 {session.notes}</div>}
          </div>
        ) : (
          <div className="tl-no-session">No market data</div>
        )}
      </div>

      {/* Emotion + comment — vertical emotion strip on left, textarea on right */}
      <div className="tl-comment-col">
        <div className="tl-emotion-notes">
          {/* Vertical emotion picker */}
          <div className="tl-emotions-vert">
            {EMOTIONS.map(e => (
              <button
                key={e.key}
                title={e.label}
                className={`emotion-btn${emotion === e.key ? ' selected' : ''}`}
                onClick={() => setEmotion(prev => prev === e.key ? '' : e.key)}
              >
                {e.emoji}
              </button>
            ))}
          </div>

          {/* Notes: textarea fills to last emotion, save+upload share one line */}
          <div className="tl-notes-area">
            <AutoTextarea
              className="tl-comment-input"
              placeholder="Notes for this day…"
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
            <div className="tl-bottom-row">
              <div className="tl-save-actions">
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {saved && <span className="save-ok">✓ Saved</span>}
                {emotion && (
                  <span className="tl-emotion-label">
                    {EMOTIONS.find(e => e.key === emotion)?.emoji}{' '}
                    {EMOTIONS.find(e => e.key === emotion)?.label}
                  </span>
                )}
              </div>
              <div className="tl-upload-inline">
                <ImageUpload
                  images={initComment?.images || []}
                  uploadUrl={`/api/trades/${tradeId}/comments/${date}/images`}
                  deleteUrlFn={fname => `/api/trades/${tradeId}/comments/${date}/images/${fname}`}
                  onImagesChange={onImagesChange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TradeDetail() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const [trade, setTrade]       = useState(null);
  const [comments, setComments] = useState([]);
  const [sessions, setSessions] = useState({});
  const [tab, setTab]           = useState('timeline');
  const [loading, setLoading]   = useState(true);

  const loadComments = useCallback(() => {
    return axios.get(`/api/trades/${id}/comments`).then(r => setComments(r.data));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      axios.get(`/api/trades/${id}`).then(r => setTrade(r.data)),
      loadComments(),
    ]).finally(() => setLoading(false));
  }, [id, loadComments]);

  // load market sessions for the date range once we have the trade
  useEffect(() => {
    if (!trade) return;
    const today    = localDateStr();
    const endDate  = trade.close_date || today;
    axios.get('/api/sessions', { params: { from: trade.date, to: endDate } })
      .then(r => {
        const map = {};
        r.data.forEach(s => { map[s.date] = s; });
        setSessions(map);
      });
  }, [trade]);

  const handleSaveComment = useCallback(async (date, comment, emotion) => {
    await axios.post(`/api/trades/${id}/comments`, { date, comment, emotion });
    await loadComments();
  }, [id, loadComments]);

  if (loading) return <div className="loading">Loading…</div>;
  if (!trade)  return <div className="error-msg">Trade not found.</div>;

  const today   = localDateStr();
  const endDate = trade.close_date || today;
  const dates   = generateDateRange(trade.date, endDate);
  const daysHeld = daysBetween(trade.date, endDate);

  const commentByDate = {};
  comments.forEach(c => { commentByDate[c.date] = c; });

  const netPremium = calcNetPremium(trade.legs);
  const pnl        = trade.status === 'closed' ? calcPnl(trade.legs) : null;
  const returnPct  = pnl != null && netPremium !== 0
    ? ((pnl / Math.abs(netPremium)) * 100).toFixed(1)
    : null;

  // best/worst NIFTY day in range
  const sessionList = Object.values(sessions).filter(s => s.prev_close && s.close);
  const withPct = sessionList.map(s => ({
    ...s,
    pct: ((s.close - s.prev_close) / s.prev_close * 100),
  }));
  const bestDay  = withPct.length ? withPct.reduce((a, b) => b.pct > a.pct ? b : a) : null;
  const worstDay = withPct.length ? withPct.reduce((a, b) => b.pct < a.pct ? b : a) : null;

  const legsLabel = trade.legs
    .map(l => `${l.side} ${l.lots}L ${l.strike}${l.type}`)
    .join(' · ');

  return (
    <div className="trade-detail-page">
      {/* ── Header ──────────────────────────────── */}
      <div className="td-header">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/trades')}>← Back</button>
        <div className="td-title">
          <h1>{trade.strategy || trade.instrument}</h1>
          <div className="td-legs-label">{trade.instrument} · {legsLabel}</div>
        </div>
        <span className={`status-badge ${trade.status}`} style={{ fontSize: 13, padding: '4px 14px' }}>
          {trade.status}
        </span>
      </div>

      {/* ── P&L Banner ──────────────────────────── */}
      <div className="td-banner">
        <div className="td-banner-cell">
          <div className="td-banner-label">Net Premium</div>
          <div className={`td-banner-value ${netPremium < 0 ? 'pos' : netPremium > 0 ? 'neg' : ''}`}>
            {netPremium === 0 ? '—'
              : `${netPremium < 0 ? 'Rcv' : 'Pay'} ₹${Math.abs(netPremium).toFixed(0)}`}
          </div>
        </div>
        <div className="td-banner-cell">
          <div className="td-banner-label">Realised P&amp;L</div>
          <div className={`td-banner-value ${pnl == null ? '' : pnl >= 0 ? 'pos' : 'neg'}`}>
            {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}₹${Math.round(pnl).toLocaleString('en-IN')}`}
          </div>
        </div>
        <div className="td-banner-cell">
          <div className="td-banner-label">Return %</div>
          <div className={`td-banner-value ${returnPct == null ? '' : Number(returnPct) >= 0 ? 'pos' : 'neg'}`}>
            {returnPct == null ? '—' : `${Number(returnPct) >= 0 ? '+' : ''}${returnPct}%`}
          </div>
        </div>
        <div className="td-banner-cell">
          <div className="td-banner-label">Days Held</div>
          <div className="td-banner-value neutral">{daysHeld}</div>
        </div>
        <div className="td-banner-cell">
          <div className="td-banner-label">Entry Date</div>
          <div className="td-banner-value neutral">{fmtDate(trade.date)}</div>
        </div>
        {trade.close_date && (
          <div className="td-banner-cell">
            <div className="td-banner-label">Close Date</div>
            <div className="td-banner-value neutral">{fmtDate(trade.close_date)}</div>
          </div>
        )}
        {bestDay && (
          <div className="td-banner-cell">
            <div className="td-banner-label">Best NIFTY Day</div>
            <div className="td-banner-value pos">▲{bestDay.pct.toFixed(2)}% ({fmtDate(bestDay.date)})</div>
          </div>
        )}
        {worstDay && (
          <div className="td-banner-cell">
            <div className="td-banner-label">Worst NIFTY Day</div>
            <div className="td-banner-value neg">▼{Math.abs(worstDay.pct).toFixed(2)}% ({fmtDate(worstDay.date)})</div>
          </div>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────── */}
      <div className="td-tabs">
        {[
          { key: 'timeline',  label: 'Day-by-Day Timeline' },
          { key: 'comments',  label: `Comment Log (${comments.filter(c => c.comment).length})` },
          { key: 'summary',   label: 'Trade Summary' },
          ...(trade.status === 'open' ? [{ key: 'exitplan', label: '✦ AI Exit Plan' }] : []),
        ].map(t => (
          <button
            key={t.key}
            className={`td-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Timeline ───────────────────────── */}
      {tab === 'timeline' && (
        <div className="td-timeline">
          <div className="timeline-header-row">
            <div className="tl-date-col tl-col-header">Date</div>
            <div className="tl-nifty-col tl-col-header">NIFTY</div>
            <div className="tl-comment-col tl-col-header">Emotion &amp; Notes</div>
          </div>
          {[...dates].reverse().map((date) => {
            const marker = date === trade.date ? 'ENTRY'
              : (trade.close_date && date === trade.close_date) ? 'EXIT'
              : (!trade.close_date && date === today) ? 'TODAY'
              : 'ACTIVE';
            return (
              <TimelineRow
                key={date}
                date={date}
                marker={marker}
                session={sessions[date] || null}
                comment={commentByDate[date] || null}
                onSave={handleSaveComment}
                tradeId={id}
                onImagesChange={loadComments}
              />
            );
          })}
        </div>
      )}

      {/* ── Tab: Comment Log ────────────────────── */}
      {tab === 'comments' && (
        <div className="td-comment-log">
          {comments.filter(c => c.comment).length === 0 ? (
            <div className="diary-empty-hint" style={{ padding: 32 }}>
              No comments yet. Add notes in the Timeline tab.
            </div>
          ) : (
            comments.filter(c => c.comment).map(c => {
              const em = EMOTIONS.find(e => e.key === c.emotion);
              const s  = sessions[c.date];
              const p  = s?.prev_close && s?.close
                ? ((s.close - s.prev_close) / s.prev_close * 100).toFixed(2)
                : null;
              return (
                <div key={c.id} className="comment-log-item">
                  <div className="cli-header">
                    <span className="cli-date">{fmtDateShort(c.date)}</span>
                    {em && <span className="cli-emotion">{em.emoji} {em.label}</span>}
                    {p !== null && (
                      <span className={`cli-nifty ${Number(p) >= 0 ? 'pos' : 'neg'}`}>
                        NIFTY {Number(p) >= 0 ? '▲' : '▼'}{Math.abs(p)}%
                        {s?.close && ` @ ${s.close.toLocaleString('en-IN')}`}
                      </span>
                    )}
                  </div>
                  <div className="cli-comment">{c.comment}</div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Tab: Summary ────────────────────────── */}
      {tab === 'summary' && (
        <div className="td-summary">
          <div className="form-card">
            <h3>Trade Details</h3>
            <div className="summary-grid">
              <div className="sg-item"><span className="sg-label">Instrument</span><span className="sg-val">{trade.instrument}</span></div>
              <div className="sg-item"><span className="sg-label">Strategy</span><span className="sg-val">{trade.strategy || '—'}</span></div>
              <div className="sg-item"><span className="sg-label">Status</span><span className="sg-val"><span className={`status-badge ${trade.status}`}>{trade.status}</span></span></div>
              <div className="sg-item"><span className="sg-label">Entry Date</span><span className="sg-val">{fmtDate(trade.date)}</span></div>
              {trade.close_date && <div className="sg-item"><span className="sg-label">Close Date</span><span className="sg-val">{fmtDate(trade.close_date)}</span></div>}
              <div className="sg-item"><span className="sg-label">Days Held</span><span className="sg-val">{daysHeld}</span></div>
              <div className="sg-item"><span className="sg-label">Lot Size</span><span className="sg-val">{LOT_SIZE}</span></div>
              {trade.tags?.length > 0 && (
                <div className="sg-item">
                  <span className="sg-label">Tags</span>
                  <span className="sg-val">{trade.tags.join(', ')}</span>
                </div>
              )}
            </div>
            {trade.notes && (
              <div className="sg-notes">
                <div className="sg-label" style={{ marginBottom: 4 }}>Notes</div>
                <div className="sg-notes-text">{trade.notes}</div>
              </div>
            )}
          </div>

          <div className="form-card">
            <h3>Legs</h3>
            <table className="legs-table">
              <thead>
                <tr>
                  <th>B/S</th><th>Expiry</th><th>Strike</th><th>Type</th>
                  <th>Lots</th><th>Entry ₹</th><th>Exit ₹</th><th>Leg P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {trade.legs.map((l, i) => {
                  const legPnl = l.exit_price != null
                    ? Math.round((l.exit_price - l.entry_price) * LOT_SIZE * l.lots * (l.side === 'B' ? 1 : -1))
                    : null;
                  return (
                    <tr key={i} className={l.side === 'B' ? 'buy-row' : 'sell-row'}>
                      <td><span className={`side-${l.side}`}>{l.side}</span></td>
                      <td>{l.expiry || '—'}</td>
                      <td>{l.strike}</td>
                      <td>{l.type}</td>
                      <td>{l.lots}</td>
                      <td>₹{l.entry_price}</td>
                      <td>{l.exit_price != null ? `₹${l.exit_price}` : '—'}</td>
                      <td className={legPnl == null ? '' : legPnl >= 0 ? 'pnl-green' : 'pnl-red'}>
                        {legPnl == null ? '—' : `${legPnl >= 0 ? '+' : ''}₹${legPnl.toLocaleString('en-IN')}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sessionList.length > 0 && (
            <div className="form-card">
              <h3>NIFTY Context ({sessionList.length} sessions)</h3>
              <table className="legs-table">
                <thead>
                  <tr><th>Date</th><th>Prev C</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Change</th></tr>
                </thead>
                <tbody>
                  {Object.keys(sessions).sort().map(d => {
                    const s = sessions[d];
                    const p = s.prev_close && s.close
                      ? ((s.close - s.prev_close) / s.prev_close * 100).toFixed(2)
                      : null;
                    return (
                      <tr key={d}>
                        <td>{fmtDateShort(d)}</td>
                        <td>{s.prev_close?.toLocaleString('en-IN') || '—'}</td>
                        <td>{s.open?.toLocaleString('en-IN') || '—'}</td>
                        <td className="pnl-green">{s.high?.toLocaleString('en-IN') || '—'}</td>
                        <td className="pnl-red">{s.low?.toLocaleString('en-IN') || '—'}</td>
                        <td><b>{s.close?.toLocaleString('en-IN') || '—'}</b></td>
                        <td className={p == null ? '' : Number(p) >= 0 ? 'pnl-green' : 'pnl-red'}>
                          {p == null ? '—' : `${Number(p) >= 0 ? '▲' : '▼'}${Math.abs(p)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Link to={`/trades/${id}/edit`} className="btn btn-primary">Edit Trade</Link>
            <button className="btn btn-secondary" onClick={() => navigate('/trades')}>Back to Trades</button>
          </div>
        </div>
      )}

      {/* ── Tab: AI Exit Plan ───────────────────── */}
      {tab === 'exitplan' && trade.status === 'open' && (
        <ExitPlan tradeId={id} />
      )}
    </div>
  );
}
