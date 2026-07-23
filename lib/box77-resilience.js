const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

class Box77Resilience {
  constructor(wss, options = {}) {
    this.wss = wss;
    this.connections = new Map();
    this.circuitBreaker = new Map();
    this.maxConnectionsPerIP = options.maxConnectionsPerIP || 10;
    this.failureThreshold = options.failureThreshold || 5;
    this.circuitTimeout = options.circuitTimeout || 60000;
    this.connectionTimeout = options.connectionTimeout || 30000;
    this.metrics = { totalConnections: 0, peakConnections: 0, messagesPerSecond: 0, startTime: Date.now() };
    setInterval(() => this.flushMetrics(), 10000);
  }

  handleConnection(ws, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    const cb = this.circuitBreaker.get(ip);
    if (cb && cb.state === 'open') {
      if (now - cb.lastFailure < this.circuitTimeout) { ws.close(1008, 'Circuit breaker open'); return false; }
      cb.state = 'half-open';
    }
    const ipConns = Array.from(this.connections.values()).filter(c => c.ip === ip).length;
    if (ipConns >= this.maxConnectionsPerIP) { ws.close(1008, 'Connection limit exceeded'); return false; }
    const connId = `conn-${now}-${Math.random().toString(36).substring(2, 9)}`;
    ws.box77Id = connId; ws.box77IP = ip;
    this.connections.set(connId, { ws, ip, connectedAt: now, lastPing: now, messagesReceived: 0, messagesSent: 0 });
    this.metrics.totalConnections++; this.metrics.peakConnections = Math.max(this.metrics.peakConnections, this.wss.clients.size);
    ws.send(JSON.stringify({ type: 'connected', connId, reconnectStrategy: { maxRetries: 10, baseDelay: 1000, maxDelay: 30000, jitter: true }, heartbeatInterval: 30000 }));
    pino.debug({ ip, connId, total: this.wss.clients.size }, 'WS connected');
    return true;
  }

  handleDisconnect(ws) {
    if (!ws.box77Id) return;
    const conn = this.connections.get(ws.box77Id);
    if (conn) { const duration = Date.now() - conn.connectedAt; pino.debug({ connId: ws.box77Id, duration, messagesIn: conn.messagesReceived, messagesOut: conn.messagesSent }, 'WS disconnected'); }
    this.connections.delete(ws.box77Id);
  }

  recordFailure(ip, reason) {
    const cb = this.circuitBreaker.get(ip) || { failures: 0, state: 'closed' };
    cb.failures++; cb.lastFailure = Date.now();
    if (cb.failures >= this.failureThreshold) { cb.state = 'open'; pino.warn({ ip, failures: cb.failures }, 'Circuit breaker OPENED'); }
    this.circuitBreaker.set(ip, cb);
  }

  flushMetrics() {
    const active = this.wss.clients.size;
    const uptime = Date.now() - this.metrics.startTime;
    pino.info({ activeConnections: active, peakConnections: this.metrics.peakConnections, totalConnections: this.metrics.totalConnections, uptimeMinutes: Math.floor(uptime / 60000) }, 'Box-77 metrics');
  }

  getStats() {
    return { activeConnections: this.wss.clients.size, peakConnections: this.metrics.peakConnections, totalConnections: this.metrics.totalConnections, circuitBreakersOpen: Array.from(this.circuitBreaker.values()).filter(cb => cb.state === 'open').length };
  }
}

module.exports = { Box77Resilience };
