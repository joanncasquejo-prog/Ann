const { migrate, pool } = require("../src/db");
migrate().then(() => { console.log("Database is up to date."); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
