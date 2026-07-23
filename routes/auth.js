const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const crypto = require('crypto');

router.post('/register', async (req, res) => {
  try {
    const { username } = req.body;
    const userId = `user-${crypto.randomUUID()}`;
    await pool.query('INSERT INTO users (user_id, username, balance, created_at) VALUES ($1, $2, $3, NOW())', [userId, username, 1000.00]);
    res.json({ userId, username, balance: 1000.00 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/wallet/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, username, balance FROM users WHERE user_id = $1', [req.params.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
