const { Pool } = require('pg');
const pino = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX) || 50,
  min: parseInt(process.env.DB_POOL_MIN) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on('error', (err, client) => {
  pino.error({ err: err.message }, 'Unexpected PostgreSQL pool error');
});

pool.on('connect', () => {
  pino.debug('New DB connection established');
});

async function healthCheck() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

async function migrate() {
  const fs = require('fs');
  const path = require('path');
  const migrationFile = path.join(__dirname, '..', 'migrations', '001_init.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');
  
  const client = await pool.connect();
  try {
    await client.query(sql);
    pino.info('Database migrations applied');
  } finally {
    client.release();
  }
}

module.exports = { pool, healthCheck, migrate };
