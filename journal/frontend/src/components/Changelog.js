import React, { useState } from 'react';

// ── Add new entries here ─────────────────────────────────────────────────────
// Each release is { date, entries: [{ type, title, description? }] }
// type: 'feature' | 'improvement' | 'fix'

const RELEASES = [
  {
    date: '2026-05-12',
    entries: [
      {
        type: 'feature',
        title: 'CSV Import (Zerodha)',
        description:
          'Import completed trades directly from a Zerodha broker order export. The importer parses instrument names, calculates weighted-average entry and exit prices per contract, and shows a preview table with per-trade checkboxes before saving.',
      },
      {
        type: 'improvement',
        title: 'White "Claude-inspired" theme',
        description:
          'Replaced the dark navy colour scheme with a clean white palette (#ffffff background, #0d0d0d text/CTA, #e5e5e5 borders) across the entire app.',
      },
      {
        type: 'improvement',
        title: 'Redesigned leg pills',
        description:
          'Compact coloured pills on the Trades list now show Buy (blue) and Sell (red) sides with strike, type, lots, and expiry — replacing the cluttered single-line text format.',
      },
      {
        type: 'improvement',
        title: 'Click-to-edit inline row expansion',
        description:
          'Removed separate View / Edit / Delete buttons. Clicking a trade row now expands an inline edit panel directly below the row. Other rows dim while a row is expanded. A "Open full detail →" link inside the panel links to the full Trade Detail page.',
      },
      {
        type: 'improvement',
        title: 'Strategy dropdown in inline editor',
        description:
          'The inline edit panel gained a datalist-backed strategy input with 10 presets (Calendar Spread, Iron Condor, etc.) matching the Add Trade form.',
      },
      {
        type: 'improvement',
        title: 'Trade Detail — vertical emotion buttons',
        description:
          'Emotion buttons on the timeline are now stacked vertically, freeing up horizontal space for a much larger session-note textarea.',
      },
      {
        type: 'improvement',
        title: 'Trade Detail — timeline layout polish',
        description:
          'Save and Upload Image are on the same line. The timeline is now in reverse-chronological order (latest date on top). Range label is bold. Fixed range text overlapping the session note.',
      },
      {
        type: 'improvement',
        title: 'Default "Open" status filter on Trades list',
        description:
          'The Trades page now loads with the status filter pre-set to "Open", hiding closed trades by default. Clicking Clear resets to show all.',
      },
    ],
  },
];

// ── Badge colours ────────────────────────────────────────────────────────────
const TYPE_META = {
  feature:     { label: 'Feature',     cls: 'cl-badge-feature' },
  improvement: { label: 'Improvement', cls: 'cl-badge-improvement' },
  fix:         { label: 'Fix',         cls: 'cl-badge-fix' },
};

// ── Component ────────────────────────────────────────────────────────────────
export default function Changelog() {
  const [expanded, setExpanded] = useState({});

  const toggle = key =>
    setExpanded(p => ({ ...p, [key]: !p[key] }));

  return (
    <div className="cl-page">
      <div className="page-header">
        <h1>Changelog</h1>
        <span className="cl-subtitle">Feature releases and improvements</span>
      </div>

      <div className="cl-timeline">
        {RELEASES.map(release => (
          <div key={release.date} className="cl-release">
            <div className="cl-release-date">{release.date}</div>
            <div className="cl-entries">
              {release.entries.map((entry, i) => {
                const key   = `${release.date}-${i}`;
                const meta  = TYPE_META[entry.type] || TYPE_META.improvement;
                const isOpen = expanded[key];
                return (
                  <div key={key} className="cl-entry">
                    <div
                      className="cl-entry-header"
                      onClick={() => entry.description && toggle(key)}
                      style={{ cursor: entry.description ? 'pointer' : 'default' }}
                    >
                      <span className={`cl-badge ${meta.cls}`}>{meta.label}</span>
                      <span className="cl-entry-title">{entry.title}</span>
                      {entry.description && (
                        <span className="cl-chevron">{isOpen ? '▲' : '▼'}</span>
                      )}
                    </div>
                    {isOpen && entry.description && (
                      <div className="cl-entry-body">{entry.description}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
