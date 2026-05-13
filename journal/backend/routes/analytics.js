const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── Helpers copied from trades.js (not exported there) ───────────────────────

const LOT_SIZE = 65;

function parseLeg(leg) {
  return {
    ...leg,
    strike:      Number(leg.strike),
    lots:        Number(leg.lots),
    entry_price: Number(leg.entry_price),
    exit_price:  leg.exit_price != null ? Number(leg.exit_price) : null,
  };
}

function calcPnl(legs, status) {
  if (status !== 'closed') return null;
  const pnl = legs.reduce((sum, leg) => {
    if (leg.exit_price == null) return sum;
    const mult = leg.side === 'B' ? 1 : -1;
    return sum + (leg.exit_price - leg.entry_price) * LOT_SIZE * leg.lots * mult;
  }, 0);
  return Math.round(pnl * 100) / 100;
}

function parseTrade(row) {
  const legs = JSON.parse(row.legs || '[]').map(parseLeg);
  const tags = JSON.parse(row.tags || '[]');
  return { ...row, legs, tags, pnl: calcPnl(legs, row.status) };
}

function dateDiffDays(d1, d2) {
  const [y1,m1,dd1] = d1.split('-').map(Number);
  const [y2,m2,dd2] = d2.split('-').map(Number);
  return (new Date(y2, m2-1, dd2) - new Date(y1, m1-1, dd1)) / 86400000;
}

// ── In-memory cache for weekly report ────────────────────────────────────────
let weeklyReportCache = null; // { report, generatedAt }

// ── GET /api/analytics/behavioral ────────────────────────────────────────────
router.get('/behavioral', (req, res) => {
  try {
    const allTrades = db.prepare('SELECT * FROM trades ORDER BY date ASC, id ASC').all().map(parseTrade);
    const closed    = allTrades.filter(t => t.status === 'closed');

    if (allTrades.length === 0) {
      return res.json({
        disciplineScore: null,
        revengeTrades: [],
        overtradingDays: [],
        lotConsistency: 100,
        strategyDrift: 0,
        expiryWeekStats: { expiryTrades: 0, expiryWinRate: null, normalWinRate: null },
        tradesByDate: [],
        holdDurationBuckets: {
          sameDay: { count: 0, winRate: null },
          short:   { count: 0, winRate: null },
          medium:  { count: 0, winRate: null },
          long:    { count: 0, winRate: null },
        },
      });
    }

    // ── Overtrading days (3+ trades opened on same date) ─────────────────────
    const tradeCountByDate = {};
    allTrades.forEach(t => {
      tradeCountByDate[t.date] = (tradeCountByDate[t.date] || 0) + 1;
    });
    const overtradingDays = Object.entries(tradeCountByDate)
      .filter(([, cnt]) => cnt >= 3)
      .map(([date]) => date);

    // ── Revenge trades ────────────────────────────────────────────────────────
    // A revenge trade: opened on the same date a prior trade closed with a loss,
    // AND it is NOT the first trade opened on that date.
    const lossByCloseDate = {};
    closed.forEach(t => {
      if (t.pnl < 0 && t.close_date) {
        lossByCloseDate[t.close_date] = true;
      }
    });

    // Group trade IDs by open date in order
    const tradesByOpenDate = {};
    allTrades.forEach(t => {
      if (!tradesByOpenDate[t.date]) tradesByOpenDate[t.date] = [];
      tradesByOpenDate[t.date].push(t.id);
    });

    const revengeTrades = [];
    allTrades.forEach(t => {
      // Was there a loss that closed on this date?
      if (!lossByCloseDate[t.date]) return;
      // Is this NOT the first trade opened on this date?
      const dateGroup = tradesByOpenDate[t.date] || [];
      if (dateGroup.indexOf(t.id) > 0) {
        revengeTrades.push(t.id);
      }
    });

    // ── Lot consistency (coefficient of variation → 0-100 score) ─────────────
    const totalLotsPerTrade = allTrades.map(t =>
      t.legs.reduce((s, l) => s + l.lots, 0)
    ).filter(x => x > 0);

    let lotConsistency = 100;
    if (totalLotsPerTrade.length > 1) {
      const mean = totalLotsPerTrade.reduce((a, b) => a + b, 0) / totalLotsPerTrade.length;
      const variance = totalLotsPerTrade.reduce((s, x) => s + (x - mean) ** 2, 0) / totalLotsPerTrade.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation
      // Convert to 0-100 score: cv=0 → 100, cv=1 → 0, capped
      lotConsistency = Math.max(0, Math.round((1 - Math.min(cv, 1)) * 100));
    }

    // ── Strategy drift (strategy changed immediately after a losing trade) ────
    let strategyDrift = 0;
    // Sort by date + id
    const sortedClosed = [...closed].sort((a, b) =>
      a.date.localeCompare(b.date) || a.id - b.id
    );
    for (let i = 1; i < sortedClosed.length; i++) {
      const prev = sortedClosed[i - 1];
      const curr = sortedClosed[i];
      if (prev.pnl < 0 && prev.strategy && curr.strategy && prev.strategy !== curr.strategy) {
        strategyDrift++;
      }
    }

    // ── Expiry week stats (Thursday trades) ──────────────────────────────────
    const expiryTrades = closed.filter(t => {
      const [y, m, d] = t.date.split('-').map(Number);
      return new Date(y, m - 1, d).getDay() === 4; // 4 = Thursday
    });
    const normalTrades = closed.filter(t => {
      const [y, m, d] = t.date.split('-').map(Number);
      return new Date(y, m - 1, d).getDay() !== 4;
    });

    const winRateOf = arr => {
      if (arr.length === 0) return null;
      const wins = arr.filter(t => t.pnl > 0).length;
      return Math.round((wins / arr.length) * 100);
    };

    const expiryWeekStats = {
      expiryTrades:  expiryTrades.length,
      expiryWinRate: winRateOf(expiryTrades),
      normalWinRate: winRateOf(normalTrades),
    };

    // ── Trades by date (for heatmap) ──────────────────────────────────────────
    const pnlByDate = {};
    allTrades.forEach(t => {
      if (!pnlByDate[t.date]) pnlByDate[t.date] = { count: 0, pnl: 0 };
      pnlByDate[t.date].count++;
      pnlByDate[t.date].pnl += (t.pnl || 0);
    });

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const tradesByDate = Object.entries(pnlByDate)
      .filter(([date]) => date >= cutoffStr)
      .map(([date, { count, pnl }]) => ({ date, count, pnl: Math.round(pnl * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Hold duration buckets ─────────────────────────────────────────────────
    const buckets = {
      sameDay: [],
      short:   [],
      medium:  [],
      long:    [],
    };
    closed.forEach(t => {
      if (!t.close_date) return;
      const days = dateDiffDays(t.date, t.close_date);
      if (days === 0)       buckets.sameDay.push(t);
      else if (days <= 3)   buckets.short.push(t);
      else if (days <= 14)  buckets.medium.push(t);
      else                  buckets.long.push(t);
    });

    const bucketStat = arr => ({
      count:   arr.length,
      winRate: winRateOf(arr),
    });

    const holdDurationBuckets = {
      sameDay: bucketStat(buckets.sameDay),
      short:   bucketStat(buckets.short),
      medium:  bucketStat(buckets.medium),
      long:    bucketStat(buckets.long),
    };

    // ── Discipline score (composite 0-100) ────────────────────────────────────
    // Components:
    //   1. Win rate consistency (based on overall win rate) — 25 pts
    //   2. Lot consistency score (already 0-100) — 25 pts
    //   3. Overtrading penalty — 25 pts
    //   4. Loss streak control — 25 pts

    const totalClosed = closed.length;
    let winRateScore = 0;
    if (totalClosed > 0) {
      const wr = closed.filter(t => t.pnl > 0).length / totalClosed;
      winRateScore = Math.round(wr * 25);
    }

    const lotScore = Math.round(lotConsistency * 0.25); // 0-25

    const overtradingPenalty = Math.min(overtradingDays.length * 5, 25);
    const overtradingScore = 25 - overtradingPenalty;

    // Loss streak control: find max consecutive loss streak
    const sortedByDate = [...closed].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    let maxStreak = 0, curStreak = 0;
    sortedByDate.forEach(t => {
      if (t.pnl < 0) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
      else            { curStreak = 0; }
    });
    const streakPenalty = Math.min(maxStreak * 4, 25);
    const streakScore = 25 - streakPenalty;

    const disciplineScore = Math.max(0, Math.min(100,
      winRateScore + lotScore + overtradingScore + streakScore
    ));

    res.json({
      disciplineScore,
      revengeTrades,
      overtradingDays,
      lotConsistency,
      strategyDrift,
      expiryWeekStats,
      tradesByDate,
      holdDurationBuckets,
    });
  } catch (err) {
    console.error('behavioral error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/sanity-check?date=YYYY-MM-DD ──────────────────────────
router.get('/sanity-check', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });

    const allTrades = db.prepare('SELECT * FROM trades ORDER BY date ASC, id ASC').all().map(parseTrade);
    const closed    = allTrades.filter(t => t.status === 'closed');

    // Trades already opened on this date
    const tradesToday = allTrades.filter(t => t.date === date).length;

    // Consecutive closed losses at the end of trade history (sorted by close_date)
    const closedSorted = [...closed]
      .filter(t => t.close_date)
      .sort((a, b) => a.close_date.localeCompare(b.close_date) || a.id - b.id);

    let lossStreak = 0;
    for (let i = closedSorted.length - 1; i >= 0; i--) {
      if (closedSorted[i].pnl < 0) lossStreak++;
      else break;
    }

    const lastTradeWasLoss = closedSorted.length > 0
      ? closedSorted[closedSorted.length - 1].pnl < 0
      : false;

    // Last 3 close dates where pnl < 0
    const recentLossDates = closedSorted
      .filter(t => t.pnl < 0)
      .slice(-3)
      .map(t => t.close_date);

    res.json({ tradesToday, lossStreak, lastTradeWasLoss, recentLossDates });
  } catch (err) {
    console.error('sanity-check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analytics/sentiment ────────────────────────────────────────────
const RED_KEYWORDS   = ['panic','fomo','revenge','recover','desperate','hope','pray','gamble','quick profit','yolo','force','must recover'];
const AMBER_KEYWORDS = ["let's see","might work","maybe","not sure","feeling","seems","risky"];

function keywordSentiment(note) {
  const lower = note.toLowerCase();
  for (const kw of RED_KEYWORDS)   { if (lower.includes(kw)) return { sentiment: 'red',   reason: `Contains risk keyword: "${kw}"` }; }
  for (const kw of AMBER_KEYWORDS) { if (lower.includes(kw)) return { sentiment: 'amber', reason: `Contains cautionary keyword: "${kw}"` }; }
  return { sentiment: 'green', reason: 'No emotional risk keywords detected' };
}

router.post('/sentiment', async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.json({ sentiment: 'green', reason: 'No note provided', usedAI: false });
    }

    // If no API key, use keyword classification
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ ...keywordSentiment(note), usedAI: false });
    }

    // Try AI classification
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic();
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `Classify the emotional state of this trading journal note as green (calm, rational, plan-based), amber (uncertain, cautious), or red (emotional, fear-driven, revenge-seeking, FOMO).

Note: "${note}"

Reply with JSON only: {"sentiment":"green"|"amber"|"red","reason":"one sentence explanation"}`
        }]
      });

      const text = message.content[0].text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json({ sentiment: parsed.sentiment, reason: parsed.reason, usedAI: true });
      }
    } catch (aiErr) {
      console.error('AI sentiment failed, falling back to keywords:', aiErr.message);
    }

    return res.json({ ...keywordSentiment(note), usedAI: false });
  } catch (err) {
    console.error('sentiment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analytics/weekly-report ────────────────────────────────────────
router.post('/weekly-report', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'API key not configured' });
  }

  // Return cached report if available
  if (weeklyReportCache) {
    return res.json({ ...weeklyReportCache, cached: true });
  }

  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const allTrades = db.prepare(
      "SELECT * FROM trades WHERE date >= ? ORDER BY date ASC, id ASC"
    ).all(cutoffStr).map(parseTrade);

    const closed = allTrades.filter(t => t.status === 'closed');
    const total  = closed.length;

    // Quick behavioral summary
    const winners   = closed.filter(t => t.pnl > 0);
    const losers    = closed.filter(t => t.pnl < 0);
    const winRate   = total > 0 ? Math.round((winners.length / total) * 100) : 0;
    const totalPnl  = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const avgLoss   = losers.length > 0
      ? Math.round(losers.reduce((s, t) => s + t.pnl, 0) / losers.length)
      : 0;

    // Overtrading days
    const countByDate = {};
    allTrades.forEach(t => { countByDate[t.date] = (countByDate[t.date] || 0) + 1; });
    const overtradingDays = Object.values(countByDate).filter(c => c >= 3).length;

    // Revenge trades
    const lossByClose = {};
    closed.forEach(t => { if (t.pnl < 0 && t.close_date) lossByClose[t.close_date] = true; });
    const tradesByDate = {};
    allTrades.forEach(t => { if (!tradesByDate[t.date]) tradesByDate[t.date] = []; tradesByDate[t.date].push(t.id); });
    let revengeTrades = 0;
    allTrades.forEach(t => {
      if (!lossByClose[t.date]) return;
      const grp = tradesByDate[t.date] || [];
      if (grp.indexOf(t.id) > 0) revengeTrades++;
    });

    // Top strategy by win rate (min 2 trades)
    const stratMap = {};
    closed.forEach(t => {
      const k = t.strategy || 'Unknown';
      if (!stratMap[k]) stratMap[k] = { wins: 0, total: 0 };
      stratMap[k].total++;
      if (t.pnl > 0) stratMap[k].wins++;
    });
    const topStrategy = Object.entries(stratMap)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0]?.[0] || 'N/A';

    // Recent trade notes (last 10 with notes)
    const recentNotes = [...closed]
      .reverse()
      .filter(t => t.notes && t.notes.trim())
      .slice(0, 10)
      .map(t => `- [${t.date}] ${t.strategy || 'Trade'} (${t.pnl >= 0 ? '+' : ''}₹${Math.round(t.pnl)}): ${t.notes.slice(0, 120)}`);

    const prompt = `You are a trading coach reviewing a NIFTY options trader's journal from the last 60 days.

## Performance Summary
- Total closed trades: ${total}
- Win rate: ${winRate}%
- Total P&L: ${totalPnl >= 0 ? '+' : ''}₹${Math.round(totalPnl).toLocaleString()}
- Average loss: ₹${Math.abs(avgLoss).toLocaleString()}
- Top strategy: ${topStrategy}

## Behavioral Flags
- Overtrading days (3+ trades): ${overtradingDays}
- Revenge trades detected: ${revengeTrades}

## Recent Trade Notes
${recentNotes.length > 0 ? recentNotes.join('\n') : 'No notes available'}

## Your Task
Write a ~300 word coaching report in markdown format. Include:
1. **Top Behavioral Patterns** — identify 2-3 key behavioral patterns (positive or negative) from the data
2. **Actionable Recommendations** — give exactly 2 specific, concrete recommendations the trader can implement immediately
3. **Positive Highlight** — highlight one positive behavior or strength to reinforce
4. **Goal for Next Week** — set one concrete, measurable goal for the coming week

Be direct, specific, and supportive. Use the actual numbers from the summary. Focus on discipline and psychology, not just P&L.`;

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const report = message.content[0].text;
    const generatedAt = new Date().toISOString();

    weeklyReportCache = { report, generatedAt };

    res.json({ report, generatedAt, cached: false });
  } catch (err) {
    console.error('weekly-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
