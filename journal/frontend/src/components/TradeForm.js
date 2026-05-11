import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const EMPTY = {
  symbol: '', date: '', direction: 'long',
  entry_price: '', exit_price: '', quantity: '',
  strategy: '', tags: '', notes: '', status: 'open',
};

export default function TradeForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const isEdit = Boolean(id);

  useEffect(() => {
    if (!isEdit) return;
    axios.get(`/api/trades/${id}`).then(r => {
      const t = r.data;
      setForm({
        ...t,
        entry_price: t.entry_price ?? '',
        exit_price:  t.exit_price  ?? '',
        quantity:    t.quantity    ?? '',
        tags:        Array.isArray(t.tags) ? t.tags.join(', ') : '',
      });
    });
  }, [id, isEdit]);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const calcPnl = () => {
    const ep  = parseFloat(form.entry_price);
    const xp  = parseFloat(form.exit_price);
    const qty = parseFloat(form.quantity);
    if (!ep || !xp || !qty) return null;
    const raw = form.direction === 'long' ? (xp - ep) * qty : (ep - xp) * qty;
    return raw.toFixed(2);
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    const payload = {
      ...form,
      symbol:      form.symbol.toUpperCase(),
      entry_price: parseFloat(form.entry_price),
      exit_price:  form.exit_price ? parseFloat(form.exit_price) : null,
      quantity:    parseFloat(form.quantity),
      tags:        form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
    try {
      if (isEdit) {
        await axios.put(`/api/trades/${id}`, payload);
      } else {
        await axios.post('/api/trades', payload);
      }
      navigate('/trades');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  const pnl = calcPnl();

  return (
    <div className="trade-form-page">
      <h1>{isEdit ? 'Edit Trade' : 'Add Trade'}</h1>
      {error && <div className="error-msg">{error}</div>}

      <form onSubmit={handleSubmit} className="trade-form">

        <div className="form-row">
          <div className="form-group">
            <label>Symbol *</label>
            <input value={form.symbol} onChange={set('symbol')} placeholder="e.g. AAPL" required />
          </div>
          <div className="form-group">
            <label>Date *</label>
            <input type="date" value={form.date} onChange={set('date')} required />
          </div>
          <div className="form-group">
            <label>Direction *</label>
            <select value={form.direction} onChange={set('direction')}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={set('status')}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Entry Price *</label>
            <input type="number" step="any" value={form.entry_price} onChange={set('entry_price')} placeholder="0.00" required />
          </div>
          <div className="form-group">
            <label>Exit Price</label>
            <input type="number" step="any" value={form.exit_price} onChange={set('exit_price')} placeholder="0.00" />
          </div>
          <div className="form-group">
            <label>Quantity *</label>
            <input type="number" step="any" value={form.quantity} onChange={set('quantity')} placeholder="0" required />
          </div>
          {pnl !== null && (
            <div className="form-group">
              <label>Estimated P&amp;L</label>
              <div className={`pnl-preview ${parseFloat(pnl) >= 0 ? 'green' : 'red'}`}>
                {parseFloat(pnl) >= 0 ? '+' : ''}${pnl}
              </div>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Strategy</label>
            <input value={form.strategy} onChange={set('strategy')} placeholder="e.g. Breakout, Trend Follow" />
          </div>
          <div className="form-group">
            <label>Tags (comma-separated)</label>
            <input value={form.tags} onChange={set('tags')} placeholder="e.g. earnings, swing, crypto" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full-width">
            <label>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={4} placeholder="Trade rationale, setup details, observations..." />
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
