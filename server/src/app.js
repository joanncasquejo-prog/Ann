const fs = require("fs");
const path = require("path");
const express = require("express");
const { config } = require("./config");
const B = require("./bookings");

const SITE = process.env.SITE_DIR || path.join(__dirname, "..", "..");   // marketing pages (repo root)
const PUBLIC = path.join(__dirname, "..", "public");                      // app pages

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self' https://checkout.paymongo.com; frame-ancestors 'none'",
    });
    next();
  });

  app.use(require("./routes/webhooks"));          // needs the raw body, so before express.json
  app.use("/api", express.json({ limit: "20kb" }));
  // Writes must be JSON: a plain cross-site form can't send that, which blocks CSRF.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) return res.status(415).json({ error: "Send JSON." });
    next();
  });
  app.use(require("./routes/auth"));
  app.use(require("./routes/public"));
  app.use(require("./routes/admin"));
  app.use(require("./routes/leader"));
  if (config.payments.provider === "mock") app.use(express.urlencoded({ extended: false }), require("./routes/mock"));

  // Home page: the marketing site with the live booking script instead of the test-mode one.
  const indexHtml = () => {
    let html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
    html = html.replace(/\s*<div id="dash"[^>]*><\/div>/, "")
      .replace(/\s*<script src="dashboard-view\.js"><\/script>/, "")
      .replace(/\s*<script src="dashboard\.js"><\/script>/, "")
      .replace('<script src="app.js"></script>', '<script src="/book.js"></script>')
      .replace(/<p class="test-note">[^<]*<\/p>/, config.testMode ? '<p class="test-note">Test mode: payments are simulated and no money is charged.</p>' : "");
    return html;
  };
  app.get(["/", "/index.html"], (req, res) => res.type("html").send(indexHtml()));
  for (const f of ["styles.css", "script.js", "terms.html", "privacy.html", "dashboard-view.js"]) {
    app.get("/" + f, (req, res) => res.sendFile(path.join(SITE, f)));
  }
  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
  app.get("/booking/:token", page("booking.html"));
  app.get("/survey/:token", page("survey.html"));
  app.get("/admin", page("admin.html"));
  app.get("/leader", page("leader.html"));
  app.get("/notes", page("notes.html"));
  app.get("/certificate/:token", async (req, res, next) => {
    try {
      const b = await B.getByToken(req.params.token);
      if (!b || b.status !== "attended" || !b.has_survey) return res.status(404).type("html").send("<p>Certificate not available. Complete your class survey first.</p>");
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const date = new Date(b.starts_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" });
      res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate of attendance</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="section"><div class="container narrow"><div class="certificate">
<p class="eyebrow">BPO Readiness</p><h1>Certificate of attendance</h1>
<p>This certifies that</p><p class="cert-name">${esc(b.name)}</p>
<p>attended the 3-hour BPO Readiness Live Class on ${date}, led by ${esc(b.leader_name || "a BPO Experience Leader")}.</p>
<p class="fine">Reference ${esc(b.ref)}. This certificate confirms attendance only; it is not a job offer or a hiring guarantee.</p>
</div></div></main></body></html>`);
    } catch (e) { next(e); }
  });
  app.use(express.static(PUBLIC, { index: false }));

  app.use((err, req, res, next) => {
    if (err instanceof B.UserError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Please try again." });
  });
  return app;
}

module.exports = { buildApp };
