import React from 'react';

export default function SanityCheckModal({ flags, onProceed, onCancel }) {
  if (!flags) return null;

  const { tradesToday, lossStreak, lastTradeWasLoss } = flags;

  const warnings = [];

  if (tradesToday >= 2) {
    // Determine rank (treat overtrading as risk factor #1 for simplicity)
    warnings.push({
      key: 'overtrading',
      icon: '📊',
      text: `You've already made ${tradesToday} trades today. Overtrading is your #1 risk factor.`,
    });
  }

  if (lossStreak >= 2) {
    warnings.push({
      key: 'lossstreak',
      icon: '📉',
      text: `You're on a ${lossStreak}-trade loss streak. Are you trading to recover?`,
    });
  }

  if (lastTradeWasLoss) {
    warnings.push({
      key: 'lastloss',
      icon: '⚠️',
      text: 'Your last trade was a loss. Ensure this isn\'t a revenge entry.',
    });
  }

  // No flags — proceed immediately (caller should have called onProceed already,
  // but guard here too)
  if (warnings.length === 0) {
    onProceed();
    return null;
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sanity-modal">
        <div className="sanity-modal-header">
          <span className="sanity-icon">⚠</span>
          <h2>Pre-Trade Review</h2>
          <p className="sanity-subtitle">Review these flags before proceeding</p>
        </div>

        <div className="sanity-flags">
          {warnings.map(w => (
            <div key={w.key} className="sanity-flag">
              <span className="sanity-flag-icon">{w.icon}</span>
              <span className="sanity-flag-text">{w.text}</span>
            </div>
          ))}
        </div>

        <div className="sanity-actions">
          <button className="btn btn-primary sanity-proceed" onClick={onProceed}>
            I've reviewed my plan — proceed
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
