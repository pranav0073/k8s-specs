const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const tradesRouter   = require('./routes/trades');
const sessionsRouter = require('./routes/sessions');

const app = express();
const PORT = process.env.PORT || 5000;

// Uploads directory (chart screenshots, etc.)
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '20mb' })); // allow base64 image payloads

app.use('/api/trades',    tradesRouter);
app.use('/api/sessions',  sessionsRouter);
app.use('/uploads',       express.static(UPLOADS_DIR));
app.get('/api/health',    (req, res) => res.json({ status: 'ok' }));

// Serve React build
const buildDir = process.env.STATIC_DIR || path.join(__dirname, 'public');
app.use(express.static(buildDir));
app.get('*', (req, res) => res.sendFile(path.join(buildDir, 'index.html')));

app.listen(PORT, () => {
  console.log(`Trading journal server running on port ${PORT}`);
});
