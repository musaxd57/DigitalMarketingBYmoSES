const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.poolIdleTimeout,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error:', err.message);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn('[DB] Slow query detected:', { duration, text: text.substring(0, 100) });
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', { message: err.message, query: text.substring(0, 100) });
    throw err;
  }
};

const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  client.query = async (text, params) => {
    return originalQuery(text, params);
  };

  client.release = () => {
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease();
  };

  return client;
};

const transaction = async (callback) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, transaction };
