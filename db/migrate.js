const fs = require("node:fs/promises");
const path = require("node:path");
async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7241902801)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const directory = path.join(__dirname, "migrations");
    for (const name of (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      if ((await client.query("SELECT name FROM schema_migrations WHERE name = $1", [name])).rowCount) continue;
      await client.query(await fs.readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
if (require.main === module) {
  require("dotenv").config();
  const pool = require("./index");
  migrate(pool).catch((error) => { console.error("Database migration failed:", error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrate };
