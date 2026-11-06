const { Pool } = require("pg");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { seed } = require("../db/seed");
async function main() {
  if (!process.env.TEST_DATABASE_URL) { console.log("SKIP backup/restore: TEST_DATABASE_URL is required"); return; }
  const original = new URL(process.env.TEST_DATABASE_URL);
  if (!/_test$|_e2e$/.test(original.pathname)) throw new Error("Use a dedicated database ending in _test or _e2e");
  const admin = new Pool({ connectionString: original.href });
  const suffix = randomUUID().replaceAll("-", ""), created = [], pools = [];
  const directory = await mkdtemp(path.join(tmpdir(), "hiking-backup-"));
  try {
    const urls = [];
    for (const prefix of ["backup_source_", "backup_restored_"]) {
      const name = prefix + suffix;
      await admin.query(`CREATE DATABASE ${name}`); created.push(name);
      const url = new URL(original); url.pathname = "/" + name; url.search = "";
      urls.push(url.href);
    }
    const source = new Pool({ connectionString: urls[0] }); pools.push(source);
    await seed(source);
    await source.query("INSERT INTO orders(total_cents) VALUES(1234)");
    await source.query("INSERT INTO order_items(order_id,product_id,quantity,price_cents,product_name) VALUES(1,1,1,1234,'Preserved demo order')");
    const filename = path.join(directory, "test.dump");
    for (const [command, args, url] of [["pg_dump", ["--dbname", urls[0], "--format=custom", "--no-owner", "--no-privileges", "--file", filename], urls[0]], ["pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname", urls[1], filename], urls[1]]]) {
      // Only newly created databases are involved; credentials are never logged.
      const result = spawnSync(command, args, { env: { ...process.env, PGDATABASE: url }, encoding: "utf8" });
      if (result.error || result.status !== 0) {
        const detail = (result.error?.code || result.stderr || "unknown error").replace(/postgres(?:ql)?:\/\/\S+/g, "[connection redacted]").replaceAll(decodeURIComponent(new URL(url).password), "[redacted]");
        throw new Error(`${command} failed: ${detail.slice(0, 600)}`);
      }
    }
    const restored = new Pool({ connectionString: urls[1] }); pools.push(restored);
    const assert = require("node:assert/strict");
    assert.equal((await restored.query("SELECT count(*) FROM products")).rows[0].count, "16");
    assert.equal((await restored.query("SELECT product_name FROM order_items WHERE order_id=1")).rows[0].product_name, "Preserved demo order");
    assert.equal((await restored.query("SELECT total_cents FROM orders WHERE id=1")).rows[0].total_cents, 1234);
    console.log("PASS backup/restore: PostgreSQL dump restored catalogue and historical order into a new database");
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
    for (const name of created.reverse()) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end(); await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
