const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

function startHeartbeat(wss, options = {}) {
  const interval = options.interval || 30000;
  const timeout = options.timeout || 60000;
  const heartbeats = new Map();

  setInterval(() => {
    const now = Date.now();
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        if (heartbeats.has(ws) && now - heartbeats.get(ws) > timeout) {
          pino.warn('Heartbeat timeout, terminating connection');
          ws.terminate();
          heartbeats.delete(ws);
          return;
        }
        heartbeats.set(ws, now);
        ws.ping();
      }
    });
  }, interval);

  wss.on('connection', (ws) => {
    heartbeats.set(ws, Date.now());
    ws.on('pong', () => { heartbeats.set(ws, Date.now()); });
  });

  wss.on('close', (ws) => { heartbeats.delete(ws); });

  pino.info(`Heartbeat started — ping every ${interval}ms, timeout ${timeout}ms`);
}

module.exports = { startHeartbeat };
