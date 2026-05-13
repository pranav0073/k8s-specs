import React, { useState } from 'react';
import axios from 'axios';

// Simple markdown-to-HTML converter — no library needed
function renderMarkdown(text) {
  if (!text) return '';

  let html = text
    // Escape HTML special chars first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers: ### H3, ## H2, # H1
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

  // Bullet lists: lines starting with - or *
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n(?!<li>)|$)/g, (match) => {
    return '<ul>' + match + '</ul>';
  });

  // Numbered lists: 1. item
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>[\s\S]*?<\/oli>)(\n(?!<oli>)|$)/g, (match) => {
    return '<ol>' + match.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>') + '</ol>';
  });

  // Paragraphs: double newlines become <p>
  html = html
    .split(/\n{2,}/)
    .map(block => {
      block = block.trim();
      if (!block) return '';
      // If already a block-level element, don't wrap
      if (/^<(h[1-6]|ul|ol|li|blockquote)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return html;
}

export default function WeeklyReport() {
  const [report, setReport]           = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [cached, setCached]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [noApiKey, setNoApiKey]       = useState(false);

  const generateReport = async () => {
    setLoading(true);
    setError('');
    setNoApiKey(false);
    try {
      const res = await axios.post('/api/analytics/weekly-report');
      setReport(res.data.report);
      setGeneratedAt(res.data.generatedAt);
      setCached(res.data.cached);
    } catch (err) {
      if (err.response?.status === 503) {
        setNoApiKey(true);
      } else {
        setError(err.response?.data?.error || 'Failed to generate report. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTime = iso => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="chart-section">
      <h2>AI Weekly Coaching Report</h2>

      {noApiKey && (
        <div className="insight-card insight-info" style={{ marginBottom: 14 }}>
          <span className="insight-icon">i</span>
          <span className="insight-text">
            Set <code style={{ fontFamily: 'monospace', background: '#dbeafe', padding: '1px 5px', borderRadius: 3 }}>ANTHROPIC_API_KEY</code> environment variable to enable AI reports.
          </span>
        </div>
      )}

      {error && (
        <div className="error-msg" style={{ marginBottom: 14 }}>{error}</div>
      )}

      {!report && !loading && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
            Generate a personalised AI coaching report based on your last 60 days of trading — covering behavioral patterns, recommendations, and goals.
          </p>
          <button className="btn btn-primary" onClick={generateReport} disabled={loading}>
            Generate AI Report
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--muted)' }}>
          <div className="spinner" />
          <span>Analysing your trading behaviour…</span>
        </div>
      )}

      {report && (
        <div>
          <div className="report-meta">
            <span className="report-generated">Generated at: {formatTime(generatedAt)}</span>
            {cached && <span className="report-cached-badge">Cached</span>}
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={generateReport}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          <div
            className="weekly-report"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(report) }}
          />
        </div>
      )}
    </div>
  );
}
