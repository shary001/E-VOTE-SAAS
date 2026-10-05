require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(fs.readFileSync('db/migrate_add_candidate_profile.sql', 'utf8'))
  .then(() => { console.log('Migration OK'); pool.end(); })
  .catch(e => { console.error('Migration FAILED:', e.message); pool.end(); process.exit(1); });
