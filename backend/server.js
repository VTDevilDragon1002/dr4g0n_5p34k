/* ══════════════════════════════════════════════════════════
   DR4G0N 5P34K — Backend Server (Node.js + Express)
   Deploy on Vercel as serverless functions
   ══════════════════════════════════════════════════════════ */
const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'DR4G0N 5P34K API' });
});

// Verify Firebase ID token (called from frontend)
app.post('/api/verify-token', async (req, res) => {
  try {
    // In production: use firebase-admin to verify token
    // const admin = require('firebase-admin');
    // const decoded = await admin.auth().verifyIdToken(req.body.token);
    // res.json({ uid: decoded.uid, email: decoded.email });
    res.json({ message: 'Token verification endpoint ready' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`DR4G0N 5P34K API running on port ${PORT}`));

module.exports = app;
