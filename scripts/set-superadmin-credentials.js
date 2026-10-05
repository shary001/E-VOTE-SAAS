require("dotenv").config();

const { Client } = require("pg");
const bcrypt = require("bcryptjs");

function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter the password safely.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Password entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    }

    process.stdin.on("data", onData);
  });
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: node scripts/set-superadmin-credentials.js new-admin@example.com");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const existingAdmins = await client.query(
      "select id from users where role = 'super_admin'"
    );
    if (existingAdmins.rowCount !== 1) {
      throw new Error(`Expected exactly one super-admin account; found ${existingAdmins.rowCount}.`);
    }

    const password = await readSecret("New password (12+ characters): ");
    if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
    const confirmation = await readSecret("Confirm new password: ");
    if (password !== confirmation) throw new Error("The passwords do not match.");

    await client.query("BEGIN");
    const admins = await client.query(
      "select id from users where role = 'super_admin' for update"
    );
    if (admins.rowCount !== 1) {
      throw new Error(`Expected exactly one super-admin account; found ${admins.rowCount}.`);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await client.query(
      `update users
          set email = $1,
              password_hash = $2,
              password_reset_token = null,
              password_reset_expires = null
        where id = $3 and role = 'super_admin'
        returning id, email, role, password_hash`,
      [email, passwordHash, admins.rows[0].id]
    );
    if (updated.rowCount !== 1 || !(await bcrypt.compare(password, updated.rows[0].password_hash))) {
      throw new Error("Credential verification failed.");
    }

    await client.query("COMMIT");
    console.log(`Super-admin credentials updated and verified for ${updated.rows[0].email}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});