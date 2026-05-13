import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import SanityCheckModal from './SanityCheckModal';

// ── Client-side keyword sentiment (mirrors backend logic) ─────────────────────
const RED_KEYWORDS   = ['panic','fomo','revenge','recover','desperate','hope','pray','gamble','quick profit','yolo','force','must recover'];
const AMBER_KEYWORDS = ["let's see","might work","maybe","not sure","feeling","seems","risky"];

function clientSentiment(note) {
  if (!note || !note.trim()) return null;
  const lower = note.toLowerCase();
  for (const kw of RED_KEYWORDS)   { if (lower.includes(kw)) return 'red'; }
  for (const kw of AMBER_KEYWORDS) { if (lower.includes(kw)) return 'amber'; }
  return 'green';
}

const LOT_SIZE = 65;

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY_LEG = { side: 'S', expiry: '', strike: '', type: 'PE', lots: 1, entry_price: '', exit_price: '' };

const EMPTY_FORM = {
  instrument: 'NIFTY',
  date: localDateStr(),
  close_date: '',
  strategy: '',
  status: 'open',
  notes: '',
  tags: '',
};

const STRATEGIES = [
  'Calendar Spread', 'Bull Put Spread', 'Bear Call Spread',
  'Iron Condor', 'Straddle', 'Strangle', 'Butterfly',
  'Ratio Spread', 'Jade Lizard', 'Naked',
];

export default function TradeForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [legs, setLegs] = useState([
    { ...EMPTY_LEG, side: 'S' },
    { ...EMPTY_LEG, side: 'B' },
  ]);
  const [error, setError]               = useState('');
  const [sanityFlags, setSanityFlags]   = useState(null);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const isEdit = Boolean(id);

  useEffect(() => {
    if (!isEdit) return;
    axios.get(`/api/trades/${id}`).then(r => {
      const t = r.data;
      setForm({
        instrument: t.instrument,
        date: t.date,
        close_date: t.close_date || '',
        strategy: t.strategy || '',
        status: t.status,
        notes: t.notes || '',
        tags: Array.isArray(t.tags) ? t.tags.join(', ') : '',
      });
      setLegs(t.legs.map(l => ({
        ...l,
        entry_price: l.entry_price ?? '',
        exit_price:  l.exit_price  ?? '',
      })));
    });
  }, [id, isEdit]);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const addLeg = () => setLegs(p => [...p, { ...EMPTY_LEG, side: p.length % 2 === 0 ? 'S' : 'B' }]);
  const removeLeg = idx => setLegs(p => p.filter((_, i) => i !== idx));
  const updateLeg = (idx, field, val) =>
    setLegs(p => p.map((l, i) => i === idx ? { ...l, [field]: val } : l));

  // Net premium: positive = debit (paid), negative = credit (received)
  const netPremiumPts = legs.reduce((sum, l) => {
    const price = parseFloat(l.entry_price) || 0;
    const lots  = parseInt(l.lots) || 0;
    return sum + price * lots * (l.side === 'B' ? 1 : -1);
  }, 0);
  const netPremiumRs = netPremiumPts * LOT_SIZE;

  const hasAllExits = legs.length > 0 && legs.every(l => l.exit_price !== '' && l.exit_price != null);
  const estPnl = hasAllExits
    ? legs.reduce((sum, l) => {
        const ep   = parseFloat(l.entry_price) || 0;
        const xp   = parseFloat(l.exit_price)  || 0;
        const lots = parseInt(l.lots) || 0;
        return sum + (xp - ep) * LOT_SIZE * lots * (l.side === 'B' ? 1 : -1);
      }, 0)
    : null;

  // The actual save logic, called after sanity check passes
  const doSave = useCallback(async () => {
    setError('');
    const cleanLegs = legs.map(l => ({
      side:        l.side,
      expiry:      l.expiry,
      strike:      Number(l.strike),
      type:        l.type,
      lots:        Number(l.lots),
      entry_price: parseFloat(l.entry_price),
      exit_price:  l.exit_price !== '' ? parseFloat(l.exit_price) : null,
    }));
    const payload = {
      ...form,
      legs: cleanLegs,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      close_date: form.close_date || null,
    };
    try {
      if (isEdit) await axios.put(`/api/trades/${id}`, payload);
      else        await axios.post('/api/trades', payload);
      navigate('/trades');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  }, [legs, form, isEdit, id, navigate]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');

    // For new trades only, run sanity check
    if (!isEdit) {
      try {
        const res = await axios.get(`/api/analytics/sanity-check?date=${form.date}`);
        const flags = res.data;
        const hasFlag = flags.tradesToday >= 2 || flags.lossStreak >= 2 || flags.lastTradeWasLoss;
        if (hasFlag) {
          setSanityFlags(flags);
          setPendingSubmit(true);
          return; // Wait for user confirmation in modal
        }
      } catch {
        // If sanity check fails, proceed silently
      }
    }

    await doSave();
  };

  const onSanityProceed = async () => {
    setSanityFlags(null);
    setPendingSubmit(false);
    await doSave();
  };

  const onSanityCancel = () => {
    setSanityFlags(null);
    setPendingSubmit(false);
  };

  const noteSentiment = clientSentiment(form.notes);
  const sentimentColor = noteSentiment === 'red' ? '#dc2626' : noteSentiment === 'amber' ? '#d97706' : '#16a34a';
  const sentimentTooltip = noteSentiment === 'red'
    ? 'Red: emotional/risk keywords detected (panic, FOMO, revenge…)'
    : noteSentiment === 'amber'
    ? 'Amber: cautionary keywords detected (maybe, risky, not sure…)'
    : noteSentiment === 'green'
    ? 'Green: note appears calm and rational'
    : '';

  return (
    <div className="trade-form-page">
      <h1>{isEdit ? 'Edit Trade' : 'Add Trade'}</h1>
      {error && <div className="error-msg">{error}</div>}

      {pendingSubmit && sanityFlags && (
        <SanityCheckModal
          flags={sanityFlags}
          onProceed={onSanityProceed}
          onCancel={onSanityCancel}
        />
      )}

      <form onSubmit={handleSubmit}>

        {/* ── Trade details ── */}
        <div className="form-card">
          <h3>Trade Details</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Instrument</label>
              <select value={form.instrument} onChange={set('instrument')}>
                <option>NIFTY</option>
                <option>BANKNIFTY</option>
                <option>FINNIFTY</option>
                <option>MIDCPNIFTY</option>
              </select>
            </div>
            <div className="form-group">
              <label>Date *</label>
              <input type="date" value={form.date} onChange={set('date')} required />
            </div>
            <div className="form-group">
              <label>Strategy</label>
              <input
                list="strat-list"
                value={form.strategy}
                onChange={set('strategy')}
                placeholder="Select or type…"
              />
              <datalist id="strat-list">
                {STRATEGIES.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={set('status')}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="form-group">
              <label>Close Date</label>
              <input type="date" value={form.close_date} onChange={set('close_date')} />
            </div>
          </div>
        </div>

        {/* ── Legs ── */}
        <div className="form-card">
          <h3>Legs</h3>
          <div className="legs-table-wrap">
          <table className="legs-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>B/S</th>
                <th style={{ width: 100 }}>Expiry</th>
                <th style={{ width: 90 }}>Strike</th>
                <th style={{ width: 60 }}>Type</th>
                <th style={{ width: 60 }}>Lots</th>
                <th>Entry ₹</th>
                <th>Exit ₹</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, idx) => (
                <tr key={idx} className={leg.side === 'B' ? 'buy-row' : 'sell-row'}>
                  <td>
                    <select
                      value={leg.side}
                      onChange={e => updateLeg(idx, 'side', e.target.value)}
                      className={`side-${leg.side}`}
                    >
                      <option value="B">B</option>
                      <option value="S">S</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={leg.expiry}
                      onChange={e => updateLeg(idx, 'expiry', e.target.value)}
                      placeholder="19 May"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={leg.strike}
                      onChange={e => updateLeg(idx, 'strike', e.target.value)}
                      placeholder="23500"
                    />
                  </td>
                  <td>
                    <select value={leg.type} onChange={e => updateLeg(idx, 'type', e.target.value)}>
                      <option value="PE">PE</option>
                      <option value="CE">CE</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={leg.lots}
                      onChange={e => updateLeg(idx, 'lots', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.05"
                      value={leg.entry_price}
                      onChange={e => updateLeg(idx, 'entry_price', e.target.value)}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.05"
                      value={leg.exit_price}
                      onChange={e => updateLeg(idx, 'exit_price', e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td>
                    {legs.length > 1 && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLeg(idx)}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <button type="button" className="btn btn-secondary btn-sm" onClick={addLeg}>+ Add Leg</button>

          {/* Summary */}
          <div className="trade-summary">
            <div className="summary-item">
              <div className="s-label">Lot Size</div>
              <div className="s-value neutral">{LOT_SIZE}</div>
            </div>
            <div className="summary-item">
              <div className="s-label">Net Premium</div>
              <div className={`s-value ${netPremiumRs > 0 ? 'debit' : netPremiumRs < 0 ? 'credit' : 'neutral'}`}>
                {netPremiumRs === 0
                  ? '—'
                  : `${netPremiumRs > 0 ? 'Pay' : 'Rcv'} ₹${Math.abs(netPremiumRs).toFixed(0)}`}
              </div>
            </div>
            {estPnl !== null && (
              <div className="summary-item">
                <div className="s-label">Estimated P&amp;L</div>
                <div className={`s-value ${estPnl >= 0 ? 'credit' : 'debit'}`}>
                  {estPnl >= 0 ? '+' : ''}₹{estPnl.toFixed(0)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes & Tags ── */}
        <div className="form-card">
          <h3>Notes &amp; Tags</h3>
          <div className="form-row">
            <div className="form-group full-width">
              <div className="note-sentiment-wrap">
                <label>Notes</label>
                {noteSentiment && (
                  <span
                    className="note-sentiment-dot"
                    style={{ background: sentimentColor }}
                    title={sentimentTooltip}
                  />
                )}
              </div>
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={3}
                placeholder="Trade rationale, market view, observations…"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Tags (comma-separated)</label>
              <input value={form.tags} onChange={set('tags')} placeholder="e.g. expiry-trade, high-iv, hedge" />
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {isEdit ? 'Update Trade' : 'Save Trade'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/trades')}>
            Cancel
          </button>
        </div>

      </form>
    </div>
  );
}
