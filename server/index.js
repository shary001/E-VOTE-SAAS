require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { pool } = require("./db");

const authRoutes = require("./routes/auth");
const superadminRoutes = require("./routes/superadmin");
const orgadminRoutes = require("./routes/orgadmin");
const electionRoutes = require("./routes/elections");
const candidateRoutes = require("./routes/candidates");
const voteRoutes = require("./routes/votes");

const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  const required = ["DATABASE_URL", "JWT_SECRET", "APP_URL", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
  if (!process.env.APP_URL.startsWith("https://")) throw new Error("APP_URL must use HTTPS in production.");
}

const app = express();

if (isProduction) app.set("trust proxy", 1);
app.use(cors({ origin: isProduction ? process.env.APP_URL.replace(/\/$/, "") : true }));
app.use(express.json());

// Production Security Headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // CSP allows inline scripts and styles used by the UI, Google Fonts, and Chart.js CDN / data URIs
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none';"
  );
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

// Comprehensive production health check
app.get("/healthz", async (req, res) => {
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const latency = Date.now() - t0;
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      db: {
        connected: true,
        latencyMs: latency,
        totalClients: pool.totalCount || 0,
        idleClients: pool.idleCount || 0,
        waitingClients: pool.waitingCount || 0,
      },
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      nodeVersion: process.version,
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      error: "Database connectivity check failed",
      message: err.message,
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use("/api/orgadmin", orgadminRoutes);
app.use("/api/elections", electionRoutes);
app.use("/api", candidateRoutes); // mounts /api/elections/:id/apply, /api/applications/:id/decision, etc.
app.use("/api", voteRoutes);      // mounts /api/elections/:id/ballot, /api/elections/:id/vote

// Static frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// JSON 404 for unmatched API routes
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Internal Server Error:", err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Something went wrong on our end.",
    ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {}),
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Voting SaaS listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
