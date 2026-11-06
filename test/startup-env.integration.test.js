const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

test("API starts from a real .env file and shuts down cleanly", {
  skip: !process.env.TEST_DATABASE_URL && "Set TEST_DATABASE_URL to an isolated PostgreSQL database",
  timeout: 30000,
}, async t => {
  const { Pool } = require("pg");
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = "startup_" + randomUUID().replaceAll("-", "");
  const directory = await mkdtemp(path.join(tmpdir(), "hiking-startup-"));
  let child;
  let stopped;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await stopped;
    }
    await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  });
  await admin.query("CREATE SCHEMA " + schema);
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", "-c search_path=" + schema);
  const origin = "http://127.0.0.1:" + port;
  const values = {
    NODE_ENV: "test", PORT: String(port), DATABASE_URL: url.href,
    SESSION_SECRET: randomUUID() + randomUUID(), APP_ORIGIN: origin,
    CORS_ORIGIN: origin, SESSION_SAME_SITE: "lax", DEMO_MODE: "true",
  };
  await writeFile(path.join(directory, ".env"), Object.entries(values).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 });
  const childEnv = { ...process.env };
  for (const key of [...Object.keys(values), "TEST_DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FB_APP_ID", "FB_APP_SECRET"]) delete childEnv[key];
  for (const key of Object.keys(childEnv)) if (key.startsWith("DOTENV_")) delete childEnv[key];
  let exited = null;
  child = spawn(process.execPath, [path.resolve(__dirname, "../index.js")], { cwd: directory, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume(); child.stderr.resume();
  stopped = new Promise(resolve => {
    child.once("exit", (code, signal) => { exited = { code, signal }; resolve(exited); });
    child.once("error", error => { exited = { error: error.code }; resolve(exited); });
  });
  const deadline = Date.now() + 20000;
  let ready;
  while (Date.now() < deadline) {
    assert.equal(exited, null, "The API process stopped before becoming ready");
    try {
      const response = await fetch(origin + "/ready", { headers: { Origin: origin }, signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = response; break; }
    } catch { /* Startup and migrations may still be running. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "The API must become ready using configuration loaded only from .env");
  assert.equal(ready.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await ready.json(), { ok: true });
  const count = await admin.query("SELECT count(*) FROM " + schema + ".schema_migrations");
  assert.ok(Number(count.rows[0].count) >= 5, "Startup applies the versioned migrations");
  child.kill("SIGTERM");
  let timer;
  const result = await Promise.race([stopped, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
  clearTimeout(timer);
  assert.ok(result, "SIGTERM must terminate the API without a forced kill");
  assert.equal(result.code, 0);
});
