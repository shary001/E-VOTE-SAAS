const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

let server = null;

(async () => {
  try {
    const res = await fetch(BASE + "/healthz");
    if (!res.ok) throw new Error();
  } catch {
    const app = require("../server/index");
    await new Promise((resolve) => {
      server = app.listen(3000, resolve);
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const user = (await db.query(
    "select id, email from users where email like $1 order by created_at desc limit 1",
    ["carol-%@example.com"]
  )).rows[0];
  if (!user) throw new Error("No disposable test user found.");

  const originalHash = (await db.query(
    "select password_hash from users where id = $1", [user.id]
  )).rows[0].password_hash;
  const knownPasswordHash = await bcrypt.hash("password123", 10);

  try {
    await db.query(
      `update users
          set email_verified = false,
              email_verify_code_hash = $1,
              email_verify_code_expires = $2,
              password_hash = $4
        where id = $3`,
      [await bcrypt.hash("123456", 10), new Date(Date.now() + 15 * 60 * 1000), user.id, knownPasswordHash]
    );

    const otpResponse = await fetch(`${BASE}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, code: "123456" }),
    });

    await db.query("update users set email_verified = true where id = $1", [user.id]);
    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "password123" }),
    });
    const loginBody = await loginResponse.json();
    if (!loginResponse.ok) throw new Error(`Smoke login failed (${loginResponse.status}): ${loginBody.error || "unknown error"}`);

    const changeResponse = await fetch(`${BASE}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({
        current_password: "password123",
        new_password: "temporary-secure-123",
      }),
    });

    console.log(`OTP status: ${otpResponse.status}`);
    console.log(`Password change status: ${changeResponse.status}`);
    if (otpResponse.status !== 200 || changeResponse.status !== 200) process.exitCode = 1;
  } finally {
    await db.query(
      "update users set email_verified = true, password_hash = $1 where id = $2",
      [originalHash, user.id]
    );
    await db.end();
    if (server) await new Promise((res) => server.close(res));
  }
})().catch((error) => {
  console.error("SECURITY SMOKE FAILED:", error.message);
  if (server) server.close();
  process.exit(1);
});
