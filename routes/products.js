const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET /products
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, price_cents, image_url
       FROM products
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /products/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await pool.query(
      `SELECT id, name, description, price_cents, image_url
       FROM products
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
