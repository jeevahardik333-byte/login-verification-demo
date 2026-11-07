require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("Set SESSION_SECRET in .env to a random value of at least 32 characters.");
  process.exit(1);
}

const db = new sqlite3.Database(path.join(dataDir, "app.sqlite"));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT,
    login_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`);
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || password.length < 12) {
    console.warn("Admin seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in .env.");
    return;
  }
  const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    await run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')", [email, hash]);
    console.log(`Created admin account: ${email}`);
  }
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir, table: "sessions" }),
  name: "secure_demo_sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 2
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function requireCsrf(req, res, next) {
  const sent = req.get("x-csrf-token") || req.body.csrfToken;
  if (typeof sent !== "string" || !req.session.csrfToken ||
      sent.length !== req.session.csrfToken.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrfToken))) {
    return res.status(403).json({ error: "Invalid security token. Refresh the page and try again." });
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
}
function validEmail(email) {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get("/api/csrf", (req, res) => res.json({ csrfToken: csrfToken(req) }));

app.post("/api/register", loginLimiter, requireCsrf, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({ error: "Password must be 10–72 characters long." });
    }
    const hash = await bcrypt.hash(password, 12);
    await run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')", [email, hash]);
    res.status(201).json({ message: "Demo account created. You can now log in." });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "That email is already registered." });
    console.error("Registration error:", err.message);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", loginLimiter, requireCsrf, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!validEmail(email) || !password) return res.status(400).json({ error: "Enter your email and password." });

    const user = await get("SELECT * FROM users WHERE email = ? AND active = 1", [email]);
    const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!matches) return res.status(401).json({ error: "Email or password is incorrect." });

    await run("UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?", [user.id]);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not start a secure session." });
      req.session.user = { id: user.id, email: user.email, role: user.role };
      csrfToken(req);
      res.json({ message: "Login successful.", user: req.session.user });
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user, csrfToken: csrfToken(req) });
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await all(
      `SELECT id, email, role, created_at, last_login, login_count, active
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).json({ error: "Could not load users." });
  }
});

app.post("/api/logout", requireAuth, requireCsrf, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not log out." });
    res.clearCookie("secure_demo_sid", { httpOnly: true, sameSite: "strict", secure: isProduction });
    res.json({ message: "Logged out." });
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

seedAdmin().catch((err) => {
  console.error("Admin setup failed:", err.message);
  process.exit(1);
});

app.listen(PORT, () => console.log(`Secure Login Demo running at http://localhost:${PORT}`));
