const express = require('express');
const cors = require('cors');
const tradesRouter = require('./routes/trades');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/trades', tradesRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Trading journal server running on port ${PORT}`);
});
