const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const { pool } = require('./lib/db');
const { redis, pub, sub } = require('./lib/redis');
const healthRoutes = require('./routes/health');
const gameRoutes = require('./routes/game');
const authRoutes = require('./routes/auth');
const CrashGameSocket = require('./websocket/crash-game');
const WarpVortexSocket = require('./websocket/warp-vortex');
const { startHeartbeat } = require('./lib/amazon-heartbeat');
const { Box77Resilience } = require('./lib/box77-resilience');

const app = express();
const server = createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10kb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/health', healthRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/auth', authRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 50
  },
  maxPayload: 64 * 1024
});

const resilience = new Box77Resilience(wss);
const crashGame = new CrashGameSocket(wss, redis, pub, sub);
const warpVortex = new WarpVortexSocket(wss, redis, pub, sub);

wss.on('connection', (ws, req) => {
  resilience.handleConnection(ws, req);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.topic?.startsWith('crash:')) {
        crashGame.handleMessage(ws, msg);
      } else if (msg.topic?.startsWith('warp:')) {
        warpVortex.handleMessage(ws, msg);
      }
    } catch (err) {
      pino.warn({ err: err.message }, 'Invalid WS message');
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    crashGame.handleDisconnect(ws);
    warpVortex.handleDisconnect(ws);
    resilience.handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    pino.error({ err: err.message }, 'WebSocket error');
  });
});

startHeartbeat(wss, { interval: 30000, timeout: 60000 });

process.on('SIGTERM', async () => {
  pino.info('SIGTERM received, shutting down gracefully...');
  wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  await pool.end();
  await redis.quit();
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  pino.info(`Talon Crash Backend v3.0 — Port ${PORT} — PID ${process.pid}`);
  pino.info(`WebSocket ready for ${process.env.MAX_CONCURRENT || '400K'} concurrent connections`);
});

module.exports = { app, server, wss };
