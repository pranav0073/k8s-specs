# Trading Journal

A full-featured trading journal with a React frontend and Node.js/Express backend backed by SQLite.

## Features

- Log trades (symbol, date, direction, entry/exit, quantity, strategy, tags, notes)
- Real-time P&L calculation while entering a trade
- Filter trades by symbol, direction, status, strategy, and date range
- Dashboard with equity curve, monthly P&L bar chart, P&L by symbol, win rate, and best/worst trades

## Quick Start

### Backend

```bash
cd journal/backend
npm install
npm start        # runs on http://localhost:5000
```

### Frontend

```bash
cd journal/frontend
npm install
npm start        # runs on http://localhost:3000 (proxies API to :5000)
```

## API Endpoints

| Method | Path                  | Description            |
|--------|-----------------------|------------------------|
| GET    | /api/trades           | List trades (filterable via query params: symbol, direction, status, strategy, from, to, tag) |
| POST   | /api/trades           | Create trade           |
| GET    | /api/trades/stats     | Dashboard stats        |
| GET    | /api/trades/:id       | Get single trade       |
| PUT    | /api/trades/:id       | Update trade           |
| DELETE | /api/trades/:id       | Delete trade           |
