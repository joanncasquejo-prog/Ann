// Shared helpers for the app pages.
window.BPO = {
  async api(path, body, method) {
    const r = await fetch(path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || "Something went wrong. Please try again."); e.status = r.status; throw e; }
    return data;
  },
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  day: (t) => new Date(t).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" }),
  time: (t) => new Date(t).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }),
  when(t) { return `${this.day(t)} · ${this.time(t)}–${this.time(new Date(t).getTime() + 3 * 3600000)}`; },
};
