const express = require('express');
const router = express.Router();
const { healthCheck } = require('../lib/db');
const { redis } = require('../lib/redis');

router.get('/', async (req, res) => {
  const checks = { status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), version: process.env.npm_package_version || '3.0.0', nodeVersion: process.version, memory: process.memoryUsage(), pid: process.pid };
  try { await healthCheck(); checks.database = 'connected'; } catch (err) { checks.database = 'error'; checks.status = 'degraded'; }
  try { await redis.ping(); checks.redis = 'connected'; } catch (err) { checks.redis = 'error'; checks.status = 'degraded'; }
  res.status(checks.status === 'healthy' ? 200 : 503).json(checks);
});

router.get('/fly', (req, res) => { res.status(200).json({ status: 'ok', fly: true }); });
router.get('/render', (req, res) => { res.status(200).json({ status: 'ok', render: true }); });

router.get('/ready', async (req, res) => {
  try { await healthCheck(); await redis.ping(); res.status(200).json({ ready: true }); } catch { res.status(503).json({ ready: false }); }
});

router.get('/live', (req, res) => { res.status(200).json({ alive: true }); });

module.exports = router;
