const express = require('express');
const cors = require('cors');
const path = require('path');
const tradesRouter = require('./routes/trades');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/trades', tradesRouter);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve React build in production
const buildDir = path.join(__dirname, 'public');
app.use(express.static(buildDir));
app.get('*', (req, res) => res.sendFile(path.join(buildDir, 'index.html')));

app.listen(PORT, () => {
  console.log(`Trading journal server running on port ${PORT}`);
});
