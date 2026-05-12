import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard   from './components/Dashboard';
import TradeList   from './components/TradeList';
import TradeForm   from './components/TradeForm';
import TradeDetail from './components/TradeDetail';
import MarketDiary from './components/MarketDiary';
import Changelog   from './components/Changelog';

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">Trading Journal</div>
      <div className="navbar-links">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/trades">Trades</NavLink>
        <NavLink to="/journal">Journal</NavLink>
        <NavLink to="/changelog">Changelog</NavLink>
        <NavLink to="/trades/new" className="add-btn">+ Add Trade</NavLink>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/trades"         element={<TradeList />} />
          <Route path="/trades/new"     element={<TradeForm />} />
          <Route path="/trades/:id"     element={<TradeDetail />} />
          <Route path="/trades/:id/edit" element={<TradeForm />} />
          <Route path="/journal"        element={<MarketDiary />} />
          <Route path="/changelog"      element={<Changelog />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
