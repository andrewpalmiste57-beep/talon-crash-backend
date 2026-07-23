const WebSocket = require('ws');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

class WarpVortexSocket {
  constructor(wss, redis, pub, sub) {
    this.wss = wss;
    this.redis = redis;
    this.pub = pub;
    this.sub = sub;
    this.upstream = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.upstreamUrl = process.env.WARP_VORTEX_URL || 'wss://warp-vortex-backend2.onrender.com/ws/build';
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connect();
  }

  connect() {
    if (this.upstream?.readyState === WebSocket.OPEN) return;
    try {
      this.upstream = new WebSocket(this.upstreamUrl, { handshakeTimeout: 10000, perMessageDeflate: false });
      this.upstream.on('open', () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        pino.info('Warp Vortex upstream connected');
        this.upstream.send(JSON.stringify({ type: 'auth', service: 'talon-crash', token: process.env.WARP_VORTEX_TOKEN }));
      });
      this.upstream.on('message', (data) => {
        try { const msg = JSON.parse(data); this.handleUpstreamMessage(msg); } catch (err) { pino.warn({ err: err.message }, 'Invalid upstream message'); }
      });
      this.upstream.on('close', (code, reason) => {
        this.connected = false;
        pino.warn({ code, reason: reason?.toString() }, 'Warp Vortex upstream closed');
        this.scheduleReconnect();
      });
      this.upstream.on('error', (err) => { pino.error({ err: err.message }, 'Warp Vortex upstream error'); this.connected = false; });
    } catch (err) { pino.error({ err: err.message }, 'Failed to connect to Warp Vortex'); this.scheduleReconnect(); }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      pino.info(`Reconnecting to Warp Vortex in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  handleUpstreamMessage(msg) {
    if (msg.type === 'global_alert' || msg.type === 'maintenance') this.broadcastToLocals(msg);
    if (msg.type === 'telemetry') this.redis.setex('warp:telemetry', 60, JSON.stringify(msg));
  }

  broadcastToLocals(message) {
    const payload = JSON.stringify({ topic: 'warp:relay', ...message });
    this.wss.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(payload); });
  }

  handleMessage(ws, msg) { if (msg.event === 'telemetry') this.sendUpstream(msg); }
  sendUpstream(msg) { if (this.connected && this.upstream?.readyState === WebSocket.OPEN) this.upstream.send(JSON.stringify(msg)); }
  handleDisconnect(ws) {}
}

module.exports = WarpVortexSocket;
