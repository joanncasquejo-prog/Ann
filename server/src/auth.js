// Password hashing (scrypt) and signed session cookies, no extra dependencies.
const crypto = require("crypto");
const { config } = require("./config");
const { query } = require("./db");

const COOKIE = "bpo_session";
const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = (value) => crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");

function issueSession(res, userId) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const value = `${userId}.${expires}`;
  res.cookie(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.baseUrl.startsWith("https://"),
    maxAge: SESSION_DAYS * 86400000,
    path: "/",
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function readSession(req) {
  const raw = parseCookies(req.headers.cookie || "")[COOKIE];
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const value = `${parts[0]}.${parts[1]}`;
  const given = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(sign(value), "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Number(parts[0]);
}

function parseCookies(header) {
  return Object.fromEntries(header.split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

// Express middleware: attaches req.user or responds 401/403.
function requireRole(...roles) {
  return async (req, res, next) => {
    const id = readSession(req);
    if (!id) return res.status(401).json({ error: "Please sign in." });
    const { rows } = await query("SELECT id, email, name, role FROM users WHERE id = $1 AND active", [id]);
    if (!rows[0]) return res.status(401).json({ error: "Please sign in." });
    if (!roles.includes(rows[0].role)) return res.status(403).json({ error: "You don't have access to this." });
    req.user = rows[0];
    next();
  };
}

// Simple in-memory limit on failed logins per email + IP.
const failures = new Map();
function loginAllowed(key) {
  const f = failures.get(key);
  return !f || f.count < 5 || Date.now() - f.first > 15 * 60000;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 15 * 60000) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
function clearFailures(key) { failures.delete(key); }

module.exports = { hashPassword, verifyPassword, issueSession, clearSession, readSession, requireRole, loginAllowed, recordFailure, clearFailures };
