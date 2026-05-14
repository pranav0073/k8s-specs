const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const tradesRouter   = require('./routes/trades');
const sessionsRouter = require('./routes/sessions');
const chargesRouter  = require('./routes/charges');

const app = express();
const PORT = process.env.PORT || 5000;

// Uploads directory (chart screenshots, etc.)
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' })); // base64 image payloads

app.use('/api/trades',    tradesRouter);
app.use('/api/sessions',  sessionsRouter);
app.use('/api/charges',   chargesRouter);
app.use('/uploads',       express.static(UPLOADS_DIR));
app.get('/api/health',    (req, res) => res.json({ status: 'ok' }));

// Serve React build — prefer STATIC_DIR env var, then backend/public, then frontend/build
const buildDir = process.env.STATIC_DIR
  || (fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : path.join(__dirname, '..', 'frontend', 'build'));
app.use(express.static(buildDir));
app.get('*', (req, res) => {
  const indexPath = path.join(buildDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).send('Frontend not built. Run: cd frontend && npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`Trading journal server running on port ${PORT}`);
});
