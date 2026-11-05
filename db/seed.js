const catalogue = require("./catalogue.json");
const { migrate } = require("./migrate");
async function seed(pool) {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7241902802)");
    for (const item of catalogue) await client.query(`INSERT INTO products(name, description, price_cents, image_url, category_slug)
      SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = $1)`,
    [item.name, item.description, item.price_cents, item.image_url, item.category_slug]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
if (require.main === module) {
  require("dotenv").config();
  const pool = require("./index");
  seed(pool).catch((error) => { console.error("Catalogue seeding failed:", error.message); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { seed };
