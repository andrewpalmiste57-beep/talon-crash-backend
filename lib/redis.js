const Redis = require('ioredis');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT'];
    return targetErrors.some(e => err.message.includes(e));
  }
};

const redis = new Redis(redisConfig);
const pub = new Redis(redisConfig);
const sub = new Redis(redisConfig);

redis.on('connect', () => pino.info('Redis connected'));
redis.on('error', (err) => pino.error({ err: err.message }, 'Redis error'));
redis.on('reconnecting', () => pino.warn('Redis reconnecting...'));

process.on('SIGTERM', async () => {
  await redis.quit();
  await pub.quit();
  await sub.quit();
});

module.exports = { redis, pub, sub };
