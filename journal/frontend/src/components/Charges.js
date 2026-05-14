import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const FIELDS = [
  { key: 'brokerage',        label: 'Brokerage' },
  { key: 'stt',              label: 'STT' },
  { key: 'exchange_charges', label: 'Exchange' },
  { key: 'gst',              label: 'GST' },
  { key: 'sebi_charges',     label: 'SEBI' },
  { key: 'stamp_duty',       label: 'Stamp Duty' },
  { key: 'other',            label: 'Other' },
];

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY_FORM = Object.fromEntries(FIELDS.map(f => [f.key, '']));

function ChargeForm({ initial, onSaved, onCancel }) {
  const [date,   setDate]   = useState(initial?.date   ?? localToday());
  const [vals,   setVals]   = useState(
    initial
      ? Object.fromEntries(FIELDS.map(f => [f.key, initial[f.key] === 0 ? '' : initial[f.key]]))
      : EMPTY_FORM
  );
  const [notes,  setNotes]  = useState(initial?.notes  ?? '');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const total = FIELDS.reduce((s, f) => s + (parseFloat(vals[f.key]) || 0), 0);

  const handleSave = async () => {
    if (!date) { setErr('Date is required'); return; }
    setSaving(true); setErr('');
    const payload = {
      date,
      notes: notes || null,
      ...Object.fromEntries(FIELDS.map(f => [f.key, parseFloat(vals[f.key]) || 0])),
    };
    try {
      await axios.post('/api/charges', payload);
      onSaved();
    } catch {
      setErr('Save failed. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="charge-form-card">
      <div className="charge-form-header">
        <h3>{initial ? 'Edit Charges' : 'Add Daily Charges'}</h3>
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>

      <div className="charge-form-date">
        <label>Date *</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="charge-fields-grid">
        {FIELDS.map(f => (
          <div key={f.key} className="charge-field">
            <label>{f.label} ₹</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={vals[f.key]}
              onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="charge-total-row">
        <span className="charge-total-label">Total Charges</span>
        <span className="charge-total-value">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>

      <div className="charge-form-notes">
        <label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
      </div>

      {err && <div className="charge-error">{err}</div>}

      <div className="charge-form-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Charges'}
        </button>
      </div>
    </div>
  );
}

export default function Charges() {
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editRow,   setEditRow]   = useState(null);
  const [showForm,  setShowForm]  = useState(false);
  const [from,      setFrom]      = useState('');
  const [to,        setTo]        = useState('');

  const fetchEntries = useCallback(() => {
    setLoading(true);
    const params = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    axios.get('/api/charges', { params })
      .then(r => { setEntries(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleDelete = async (date) => {
    await axios.delete(`/api/charges/${date}`);
    setEntries(p => p.filter(e => e.date !== date));
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditRow(null);
    fetchEntries();
  };

  const grandTotal = entries.reduce((s, e) => s + (e.total || 0), 0);

  return (
    <div className="charges-page">
      <div className="page-header">
        <h1>Daily Charges</h1>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditRow(null); }}>
          + Add Charges
        </button>
      </div>

      {(showForm && !editRow) && (
        <ChargeForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />
      )}

      {/* Filters */}
      <div className="filters" style={{ marginBottom: 16 }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From date" />
        <input type="date" value={to}   onChange={e => setTo(e.target.value)}   title="To date" />
        <button className="btn btn-primary" onClick={fetchEntries}>Apply</button>
        <button className="btn btn-ghost"   onClick={() => { setFrom(''); setTo(''); }}>Clear</button>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <h2>No charges recorded</h2>
          <p>Click "+ Add Charges" to log brokerage and taxes for a trading day.</p>
        </div>
      ) : (
        <div className="charges-table-wrap">
          <table className="charges-table">
            <thead>
              <tr>
                <th>Date</th>
                {FIELDS.map(f => <th key={f.key} style={{ textAlign: 'right' }}>{f.label}</th>)}
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Notes</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <React.Fragment key={e.date}>
                  <tr className={editRow === e.date ? 'charge-editing' : ''}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 13 }}>{e.date}</td>
                    {FIELDS.map(f => (
                      <td key={f.key} style={{ textAlign: 'right', fontSize: 13 }}>
                        {e[f.key] ? `₹${e[f.key].toLocaleString('en-IN')}` : '—'}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>
                      ₹{e.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{e.notes || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setEditRow(prev => prev === e.date ? null : e.date)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
                          onClick={() => handleDelete(e.date)}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editRow === e.date && (
                    <tr>
                      <td colSpan={FIELDS.length + 4} style={{ padding: 0, border: 'none' }}>
                        <ChargeForm initial={e} onSaved={handleSaved} onCancel={() => setEditRow(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="charges-total-row">
                <td><strong>Total</strong></td>
                {FIELDS.map(f => (
                  <td key={f.key} style={{ textAlign: 'right', fontSize: 13 }}>
                    {(() => {
                      const s = entries.reduce((a, e) => a + (e[f.key] || 0), 0);
                      return s ? `₹${s.toLocaleString('en-IN')}` : '—';
                    })()}
                  </td>
                ))}
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>
                  ₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
