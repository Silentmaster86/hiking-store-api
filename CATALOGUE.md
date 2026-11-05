# Illustrative catalogue

Migration 003 corrects the original demo names/descriptions to match the existing
illustrative assets. It preserves product IDs, prices, categories and image URLs.
Custom names are left alone. Before renaming, legacy order item names are copied
from the catalogue only where no historical snapshot exists. Previously recorded
snapshots and prices are not rewritten.

Notable changes: Down Gilet → Lightweight Hiking Jacket (the image has sleeves),
Backpack Hip Belt Pouch → Compact Trail Backpack (the image shows a full pack),
Waterproof Pack Cover → Pack Storage Pouch (the image shows a packed pouch).
British terminology and unit formatting are used for the head torch and bottle.
Unverified hot/cold duration and material claims are removed from descriptions.
All items remain fictional portfolio data, not an offer for sale.

For a fresh development database, run `npm run db:seed` after configuring DATABASE_URL.
This is an explicit command: deployment/startup does not seed the catalogue. The
seed adds missing demo names, does not clear tables, and does not overwrite custom
products or matching existing entries. The frontend already contains these image
paths. Migration is tested with a legacy order plus a custom product; the seed is
run twice to verify that it does not duplicate products.
