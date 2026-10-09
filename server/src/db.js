const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { config } = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: /sslmode=require|supabase|neon/.test(config.databaseUrl || "") ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

const query = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  await query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
}

async function logEvent(db, { bookingId = null, classId = null, message }) {
  await (db || pool).query("INSERT INTO events (booking_id, class_id, message) VALUES ($1, $2, $3)", [bookingId, classId, message]);
}

module.exports = { pool, query, tx, migrate, logEvent };
