const { createHash } = require("node:crypto");
const text = (value) => typeof value === "string" ? value.trim() : "";
const postcodePattern = /^(?:GIR 0AA|[A-PR-UWYZ](?:\d{1,2}|[A-HK-Y]\d{1,2}|\d[A-HJKPSTUW]|[A-HK-Y]\d[ABEHMNPRVWXY]) \d[ABD-HJLNP-UW-Z]{2})$/;
function normalizePostcode(value) {
  const compact = text(value).toUpperCase().replace(/\s+/g, "");
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}
function validateCheckout(body) {
  const shipping = body?.shipping || {};
  const country = text(shipping.country).toUpperCase();
  const value = {
    email: text(body?.email).toLowerCase(), firstName: text(body?.firstName), lastName: text(body?.lastName),
    shipping: { address1: text(shipping.address1), address2: text(shipping.address2), city: text(shipping.city),
      postcode: normalizePostcode(shipping.postcode), country: country === "UK" ? "GB" : country },
  };
  const fieldErrors = {};
  if (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) fieldErrors.email = "Enter a valid email address.";
  for (const name of ["firstName", "lastName"]) if (!value[name] || value[name].length > 80) fieldErrors[name] = "Enter a name of up to 80 characters.";
  for (const name of ["address1", "city"]) if (!value.shipping[name] || value.shipping[name].length > 200) fieldErrors[`shipping.${name}`] = "Enter a value of up to 200 characters.";
  if (value.shipping.address2.length > 200) fieldErrors["shipping.address2"] = "Use up to 200 characters.";
  if (!postcodePattern.test(value.shipping.postcode)) fieldErrors["shipping.postcode"] = "Enter a valid UK postcode, for example SW1A 1AA.";
  if (value.shipping.country !== "GB") fieldErrors["shipping.country"] = "This demo supports United Kingdom addresses only.";
  return { value, fieldErrors, valid: Object.keys(fieldErrors).length === 0 };
}
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
module.exports = { validateCheckout, normalizePostcode, fingerprint };
