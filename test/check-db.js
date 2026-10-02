require('dotenv').config();
const { Client } = require('pg');

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

c.connect()
  .then(async () => {
    console.log('Connected to DB successfully!');
    const users = await c.query('select count(*)::int as count from users');
    const orgs = await c.query('select count(*)::int as count from organizations');
    const elections = await c.query('select count(*)::int as count from elections');
    console.log('Stats: users =', users.rows[0].count, ', orgs =', orgs.rows[0].count, ', elections =', elections.rows[0].count);
    await c.end();
  })
  .catch(err => {
    console.error('DB connect error:', err.message);
    process.exit(1);
  });
