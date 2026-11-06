require("dotenv").config();
const pool = require("./db");
const { migrate } = require("./db/migrate");
const { createApp } = require("./app");
async function start() {
  await migrate(pool);
  const server = createApp().listen(process.env.PORT || 4000, () => console.log("API is ready"));
  server.requestTimeout = 30000;
  const cleanup = setInterval(() => pool.query("DELETE FROM request_limits WHERE expires_at < NOW()")
    .catch(error => console.error("Rate-limit cleanup failed:", error.code || "internal error")), 60 * 60 * 1000);
  cleanup.unref();
  let closing = false;
  function shutdown() {
    if (closing) return; closing = true; clearInterval(cleanup);
    const force = setTimeout(() => server.closeAllConnections(), 10000); force.unref();
    server.close(async () => { clearTimeout(force); await pool.end(); });
    server.closeIdleConnections();
  }
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
start().catch(async error => {
  console.error("API startup failed:", error.code || "configuration or migration error");
  await pool.end(); process.exitCode = 1;
});
