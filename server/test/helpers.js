const { query, migrate, pool } = require("../src/db");
const { buildApp } = require("../src/app");
const { hashPassword } = require("../src/auth");
const clock = require("../src/clock");

const HOUR = 3600000;

async function resetDb() {
  await query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  clock.reset();
}

async function startServer() {
  const server = buildApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

// Minimal client with a cookie jar.
function client(base) {
  let cookie = "";
  const req = async (path, { method, json, headers = {}, raw, redirect = "manual" } = {}) => {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    let body = raw;
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const r = await fetch(base + path, { method: method || (body !== undefined ? "POST" : "GET"), headers: h, body, redirect });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  return { req, get: (p) => req(p), post: (p, json) => req(p, { json: json || {} }) };
}

async function addUser(email, name, role, password = "password-123456") {
  const { rows } = await query("INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id", [email, name, role, hashPassword(password)]);
  return rows[0].id;
}

async function addClass(hoursFromNow, leaderId = null, extra = {}) {
  const { rows } = await query("INSERT INTO classes (starts_at, leader_id, zoom_link, status) VALUES ($1,$2,$3,$4) RETURNING id",
    [new Date(clock.now().getTime() + hoursFromNow * HOUR), leaderId, "https://zoom.us/j/123", extra.status || "scheduled"]);
  return rows[0].id;
}

const details = (classId, n = 1, extra = {}) => ({
  classId, name: `Student ${n}`, email: `s${n}@example.com`, mobile: "0917 123 45" + String(n).padStart(2, "0").slice(-2),
  acceptTerms: true, acceptPrivacy: true, ...extra,
});

// Book and pay through the mock gateway (signed webhook path).
async function bookAndPay(c, classId, n = 1, extra = {}) {
  const b = await c.post("/api/bookings", details(classId, n, extra));
  if (b.status !== 201) throw new Error("booking failed: " + JSON.stringify(b.data));
  const path = new URL(b.data.checkoutUrl).pathname;
  const pay = await c.req(path + "/pay", { method: "POST" });
  if (pay.status !== 303) throw new Error("mock pay failed: " + pay.status + " " + pay.data);
  return b.data;
}

module.exports = { HOUR, resetDb, startServer, client, addUser, addClass, details, bookAndPay, pool, query, clock };
