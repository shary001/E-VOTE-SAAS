const { Pool } = require("pg");

// Supabase (and most managed Postgres hosts) require SSL. Supabase's cert
// chain isn't always in Node's default trust store, so we disable strict
// verification rather than ship a CA bundle — fine for this project, but if
// you later handle real production data, pin the CA instead.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

// Small helper so routes don't each re-import Pool directly.
async function withTransaction(fn) {
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

module.exports = { pool, withTransaction };
