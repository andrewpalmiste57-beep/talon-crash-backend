const crypto = require('crypto');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

class CrashEngine {
  constructor(redis, pub) {
    this.redis = redis;
    this.pub = pub;
    this.roundState = 'idle';
    this.currentMultiplier = 1.00;
    this.roundId = null;
    this.serverSeed = null;
    this.clientSeed = null;
    this.nonce = 0;
    this.bets = new Map();
    this.cashouts = new Map();
    this.gameLoop = null;
    this.startTime = null;
    this.HOUSE_EDGE = 0.99;
    this.MAX_MULTIPLIER = 1000.00;
    this.BETTING_PHASE_MS = 5000;
    this.TICK_RATE_MS = 50;
    this.GROWTH_RATE = 0.06;
  }

  generateCrashPoint() {
    const combined = `${this.serverSeed}:${this.clientSeed}:${this.nonce}`;
    const hash = crypto.createHmac('sha256', this.serverSeed).update(combined).digest('hex');
    const hashInt = parseInt(hash.substring(0, 13), 16);
    const maxHash = Math.pow(16, 13);
    const randomValue = hashInt / maxHash;
    const crashPoint = Math.max(1.00, Math.min(this.MAX_MULTIPLIER, Math.floor((this.HOUSE_EDGE / (1 - randomValue)) * 100) / 100));
    return { crashPoint, hash };
  }

  async applyBetState(userId, operation, amount, autoCashout = null) {
    const key = `user:${userId}:balance`;
    const betKey = `user:${userId}:active_bet`;
    
    const luaScript = `
      local balance = tonumber(redis.call('GET', KEYS[1]) or 0)
      local activeBet = redis.call('GET', KEYS[2])
      local op = ARGV[1]
      local amt = tonumber(ARGV[2])
      
      if op == 'place' then
        if balance < amt then return {-1, balance} end
        if activeBet then return {-2, balance} end
        redis.call('DECRBY', KEYS[1], math.floor(amt * 100))
        redis.call('SET', KEYS[2], cjson.encode({amount: amt, autoCashout: ARGV[3]}))
        return {1, balance - amt}
      elseif op == 'cashout' then
        if not activeBet then return {-3, balance} end
        local bet = cjson.decode(activeBet)
        local winnings = math.floor(amt * 100)
        redis.call('INCRBY', KEYS[1], winnings)
        redis.call('DEL', KEYS[2])
        return {2, balance + amt}
      elseif op == 'refund' then
        if not activeBet then return {-3, balance} end
        redis.call('INCRBY', KEYS[1], math.floor(amt * 100))
        redis.call('DEL', KEYS[2])
        return {3, balance + amt}
      end
      return {0, balance}
    `;

    const result = await this.redis.eval(luaScript, 2, key, betKey, operation, amount, autoCashout || '');
    const [status, newBalance] = result;
    
    if (status < 0) {
      const errors = { '-1': 'Insufficient balance', '-2': 'Active bet already exists', '-3': 'No active bet to cashout' };
      throw new Error(errors[status] || 'Unknown state error');
    }

    this.pub.publish('crash:state', JSON.stringify({ userId, operation, amount, newBalance, roundId: this.roundId, timestamp: Date.now() }));
    return { success: true, newBalance };
  }

  async placeBet(userId, amount, autoCashout) {
    if (this.roundState !== 'betting') throw new Error('Betting phase ended');
    if (amount <= 0) throw new Error('Invalid bet amount');
    if (autoCashout && (autoCashout < 1.01 || autoCashout > this.MAX_MULTIPLIER)) throw new Error('Invalid auto-cashout target');

    const result = await this.applyBetState(userId, 'place', amount, autoCashout);
    this.bets.set(userId, { amount, autoCashout, status: 'active', placedAt: Date.now() });

    this.broadcast({ type: 'bet_placed', userId: userId.substring(0, 8) + '...', amount, autoCashout, roundId: this.roundId });
    return result;
  }

  async cashout(userId, multiplier) {
    const bet = this.bets.get(userId);
    if (!bet || bet.status !== 'active') throw new Error('No active bet');

    const winnings = bet.amount * multiplier;
    const result = await this.applyBetState(userId, 'cashout', winnings);
    bet.status = 'cashed_out';
    this.cashouts.set(userId, multiplier);

    this.broadcast({ type: 'player_cashed_out', userId: userId.substring(0, 8) + '...', multiplier, winnings: winnings.toFixed(2), roundId: this.roundId });
    return { ...result, winnings, multiplier };
  }

  async checkAutoCashouts() {
    for (const [userId, bet] of this.bets) {
      if (bet.status !== 'active' || !bet.autoCashout) continue;
      if (this.currentMultiplier >= bet.autoCashout) {
        try { await this.cashout(userId, bet.autoCashout); } catch (err) { pino.warn({ userId, err: err.message }, 'Auto-cashout failed'); }
      }
    }
  }

  async startRound() {
    if (this.roundState !== 'idle') return;
    this.roundState = 'betting';
    this.roundId = `R-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.serverSeed = crypto.randomBytes(32).toString('hex');
    this.clientSeed = crypto.randomBytes(16).toString('hex');
    this.nonce++;
    this.bets.clear();
    this.cashouts.clear();

    const { crashPoint, hash } = this.generateCrashPoint();
    this.crashPoint = crashPoint;
    this.hash = hash;
    await this.redis.setex(`round:${this.roundId}:commitment`, 3600, hash);

    this.broadcast({ type: 'round_starting', roundId: this.roundId, bettingTime: this.BETTING_PHASE_MS, hashCommitment: hash.substring(0, 16) + '...' });
    setTimeout(() => this.startFlying(), this.BETTING_PHASE_MS);
  }

  startFlying() {
    this.roundState = 'flying';
    this.currentMultiplier = 1.00;
    this.startTime = Date.now();
    this.broadcast({ type: 'round_started', roundId: this.roundId, startTime: this.startTime });
    this.gameLoop = setInterval(() => this.tick(), this.TICK_RATE_MS);
  }

  tick() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.currentMultiplier = Math.max(1.00, Math.floor(Math.pow(Math.E, this.GROWTH_RATE * elapsed) * 100) / 100);
    this.checkAutoCashouts();
    if (this.currentMultiplier >= this.crashPoint) { this.crash(); return; }
    this.broadcast({ type: 'tick', multiplier: this.currentMultiplier, elapsed, roundId: this.roundId });
  }

  async crash() {
    clearInterval(this.gameLoop);
    this.roundState = 'crashed';
    for (const [userId, bet] of this.bets) {
      if (bet.status === 'active') await this.redis.del(`user:${userId}:active_bet`);
    }
    this.broadcast({ type: 'round_crashed', crashPoint: this.crashPoint, roundId: this.roundId, serverSeed: this.serverSeed, clientSeed: this.clientSeed, nonce: this.nonce, hash: this.hash });
    setTimeout(() => { this.roundState = 'idle'; this.startRound(); }, 3000);
  }

  broadcast(message) {
    this.pub.publish('crash:broadcast', JSON.stringify(message));
  }

  verifyRound(serverSeed, clientSeed, nonce) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHmac('sha256', serverSeed).update(combined).digest('hex');
    const hashInt = parseInt(hash.substring(0, 13), 16);
    const maxHash = Math.pow(16, 13);
    const randomValue = hashInt / maxHash;
    const crashPoint = Math.max(1.00, Math.floor((this.HOUSE_EDGE / (1 - randomValue)) * 100) / 100);
    return { crashPoint, hash };
  }
}

module.exports = CrashEngine;
