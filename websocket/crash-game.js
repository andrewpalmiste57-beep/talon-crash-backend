const CrashEngine = require('../lib/crash-engine');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

class CrashGameSocket {
  constructor(wss, redis, pub, sub) {
    this.wss = wss;
    this.redis = redis;
    this.pub = pub;
    this.sub = sub;
    this.engine = new CrashEngine(redis, pub);
    this.clients = new Map();
    
    this.sub.subscribe('crash:broadcast');
    this.sub.on('message', (channel, message) => {
      if (channel === 'crash:broadcast') this.relayBroadcast(JSON.parse(message));
    });

    setTimeout(() => this.engine.startRound(), 2000);
  }

  handleMessage(ws, msg) {
    const client = this.clients.get(ws);
    switch (msg.event) {
      case 'join': this.handleJoin(ws, msg); break;
      case 'bet': this.handleBet(ws, msg); break;
      case 'cashout': this.handleCashout(ws, msg); break;
      case 'ping': ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() })); break;
      case 'get_history': this.handleHistory(ws, msg); break;
      case 'verify': this.handleVerify(ws, msg); break;
      default: ws.send(JSON.stringify({ error: 'Unknown event', event: msg.event }));
    }
  }

  handleJoin(ws, msg) {
    const userId = msg.userId || `anon-${Math.random().toString(36).substring(2, 10)}`;
    this.clients.set(ws, { userId, channel: 'crash', subscribed: true });
    ws.send(JSON.stringify({ type: 'joined', channel: 'crash', userId, gameState: { roundState: this.engine.roundState, currentMultiplier: this.engine.currentMultiplier, roundId: this.engine.roundId, crashPoint: this.engine.roundState === 'crashed' ? this.engine.crashPoint : null } }));
    pino.debug({ userId }, 'Player joined crash channel');
  }

  async handleBet(ws, msg) {
    const client = this.clients.get(ws);
    if (!client) { ws.send(JSON.stringify({ error: 'Not joined' })); return; }
    try {
      const { amount, autoCashout } = msg;
      const result = await this.engine.placeBet(client.userId, amount, autoCashout);
      ws.send(JSON.stringify({ type: 'bet_confirmed', amount, autoCashout, newBalance: result.newBalance, roundId: this.engine.roundId }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'bet_failed', error: err.message, amount: msg.amount }));
    }
  }

  async handleCashout(ws, msg) {
    const client = this.clients.get(ws);
    if (!client) { ws.send(JSON.stringify({ error: 'Not joined' })); return; }
    try {
      const multiplier = msg.multiplier || this.engine.currentMultiplier;
      const result = await this.engine.cashout(client.userId, multiplier);
      ws.send(JSON.stringify({ type: 'cashout_confirmed', multiplier: result.multiplier, winnings: result.winnings.toFixed(2), newBalance: result.newBalance, roundId: this.engine.roundId }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'cashout_failed', error: err.message }));
    }
  }

  async handleHistory(ws, msg) {
    const limit = Math.min(msg.limit || 50, 100);
    const history = await this.redis.lrange('crash:history', 0, limit - 1);
    ws.send(JSON.stringify({ type: 'history', rounds: history.map(h => JSON.parse(h)) }));
  }

  handleVerify(ws, msg) {
    const { serverSeed, clientSeed, nonce } = msg;
    const result = this.engine.verifyRound(serverSeed, clientSeed, nonce);
    ws.send(JSON.stringify({ type: 'verification_result', ...result }));
  }

  relayBroadcast(message) {
    const payload = JSON.stringify(message);
    this.wss.clients.forEach(ws => {
      const client = this.clients.get(ws);
      if (client && client.subscribed && ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  handleDisconnect(ws) {
    this.clients.delete(ws);
  }
}

module.exports = CrashGameSocket;
