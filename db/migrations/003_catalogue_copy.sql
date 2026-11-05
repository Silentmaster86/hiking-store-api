-- Freeze old names before changing the illustrative catalogue.
UPDATE order_items oi SET product_name = p.name
FROM products p WHERE oi.product_id = p.id AND oi.product_name IS NULL;

-- Only known original demo names are changed; prices, IDs, images and categories remain.
UPDATE products p SET name = copy.name, description = copy.description, updated_at = NOW()
FROM (VALUES
  ('Trail Backpack 35L', '35 L Trail Backpack', 'Trail backpack with a 35 L capacity for day-long adventures.'),
  ('Daypack 20L', '20 L Daypack', 'Compact 20 L daypack for everyday outdoor essentials.'),
  ('Waterproof Pack Cover', 'Pack Storage Pouch', 'Compact storage pouch for carrying small essentials on a backpack.'),
  ('Backpack Hip Belt Pouch', 'Compact Trail Backpack', 'Compact backpack for day hikes and everyday outdoor essentials.'),
  ('Waterproof Hiking Jacket', 'Waterproof Hiking Jacket', 'A shell-style jacket for layering on outdoor walks.'),
  ('Fleece Midlayer', 'Fleece Midlayer', 'A comfortable fleece layer for cooler days on the trail.'),
  ('Down Gilet', 'Lightweight Hiking Jacket', 'Lightweight hooded jacket for layering on cool-weather walks.'),
  ('Rain Poncho', 'Rain Poncho', 'Packable poncho for your outdoor kit.'),
  ('Hiking Boots Mid', 'Mid-cut Hiking Boots', 'Supportive mid-cut hiking boots with a grippy outsole.'),
  ('Trail Shoes', 'Trail Shoes', 'Low-cut trail shoes for everyday walks and hikes.'),
  ('Merino Hiking Socks', 'Cushioned Hiking Socks', 'Cushioned socks for comfortable trail walks.'),
  ('Boot Waterproofing Spray', 'Footwear Care Spray', 'A footwear care accessory for your hiking kit.'),
  ('Trekking Poles (Pair)', 'Trekking Poles (Pair)', 'Aluminium trekking poles with adjustable straps.'),
  ('Insulated Bottle 750ml', '750 ml Insulated Bottle', 'Reusable insulated bottle for carrying drinks on the trail.'),
  ('Headlamp 300lm', '300 lm Head Torch', 'Compact head torch with an adjustable head strap.'),
  ('First Aid Mini Kit', 'Compact First Aid Kit', 'A compact first aid pouch for your trail essentials.')
) AS copy(old_name, name, description)
WHERE p.name = copy.old_name;
