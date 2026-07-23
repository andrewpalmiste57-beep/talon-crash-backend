const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const SeedVerifier = require('../lib/seed-verifier');

router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const result = await pool.query('SELECT round_id, crash_point, server_seed, client_seed, nonce, created_at, total_bets, total_wagered FROM rounds ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json({ rounds: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/verify/:roundId', async (req, res) => {
  try {
    const result = await pool.query('SELECT server_seed, client_seed, nonce, crash_point FROM rounds WHERE round_id = $1', [req.params.roundId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Round not found' });
    const round = result.rows[0];
    const verification = SeedVerifier.verify(round.server_seed, round.client_seed, round.nonce);
    res.json({ round, verification, fair: verification.crashPoint === round.crash_point });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || '24h';
    const intervals = { '24h': '1 day', '7d': '7 days', '30d': '30 days' };
    let query = 'SELECT user_id, COUNT(*) as total_rounds, SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins, SUM(winnings - bet_amount) as profit FROM bets';
    if (intervals[period]) query += ` WHERE created_at > NOW() - INTERVAL '${intervals[period]}'`;
    query += ' GROUP BY user_id ORDER BY profit DESC LIMIT 100';
    const result = await pool.query(query);
    res.json({ leaderboard: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as total_bets, SUM(bet_amount) as total_wagered, SUM(CASE WHEN won THEN winnings ELSE 0 END) as total_won, AVG(CASE WHEN won THEN cashout_multiplier END) as avg_cashout, MAX(cashout_multiplier) as best_cashout FROM bets WHERE user_id = $1', [req.params.userId]);
    res.json({ stats: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
