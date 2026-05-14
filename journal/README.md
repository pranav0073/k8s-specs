# Trading Journal

A personal trading journal built for NIFTY options traders — React frontend, Node.js/Express backend, SQLite database. Runs entirely on your Windows machine with no internet dependency.

## Features

- **Multi-leg options trades** — log Calendar Spreads, Iron Condors, Bull/Bear Spreads and more with per-leg entry/exit prices
- **Real-time P&L** — net premium and estimated P&L calculated live while entering a trade (lot size 65)
- **Trade Detail page** — day-by-day timeline with ENTRY/ACTIVE/EXIT markers, emotion selector (Confident/Anxious/Patient/FOMO/Greedy/Relieved), and per-day notes
- **Market Diary (Journal tab)** — log NIFTY OHLC per session, see active trades on any given day, attach chart screenshots
- **Chart screenshot uploads** — drag-and-drop chart images into sessions or trade day rows; inline thumbnails with lightbox preview
- **Dashboard** — equity curve, monthly P&L bar chart, P&L by strategy, win rate, best/worst trades
- **Filters** — filter trades by instrument, strategy, status, and date range

## Quick Start (Windows)

Double-click `start.bat` in the `journal/` folder. Opens `http://localhost:5000` automatically.

To rebuild after pulling updates:

```bat
cd journal\frontend
npm install
npm run build
```

Then re-run `start.bat`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/trades | List trades (filter: instrument, strategy, status, from, to) |
| POST | /api/trades | Create trade |
| GET | /api/trades/stats | Dashboard stats |
| GET | /api/trades/:id | Get single trade |
| PUT | /api/trades/:id | Update trade |
| DELETE | /api/trades/:id | Delete trade |
| GET | /api/trades/:id/comments | List day comments for a trade |
| POST | /api/trades/:id/comments | Upsert comment + emotion for a date |
| POST | /api/trades/:id/comments/:date/images | Upload chart image for a trade day |
| GET | /api/sessions | List market sessions |
| POST | /api/sessions | Create/update a session (upsert by date) |
| GET | /api/sessions/:date/active-trades | Trades active on a given date |
| POST | /api/sessions/:date/images | Upload chart image for a session |

## Roadmap

- [ ] **P&L calendar heatmap** — monthly calendar on the Dashboard showing daily profit/loss as a colour-coded grid
- [ ] **CSV import** — import trades from broker statement (Zerodha/Groww CSV format)
- [ ] **NIFTY auto-fetch** — pull daily OHLC automatically from NSE/Yahoo Finance instead of manual entry
- [ ] **Weekly review** — end-of-week summary of trades, emotions, key learnings, and NIFTY context
