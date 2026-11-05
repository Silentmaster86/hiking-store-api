// Backward-compatible, non-destructive setup. Product seeding is separate.
require("dotenv").config();
const pool = require("./db");
const { migrate } = require("./db/migrate");
migrate(pool).catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
