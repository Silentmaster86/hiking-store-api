const normalizeEmail = (email) => typeof email === "string" ? email.trim().toLowerCase() : "";
function validateRegistration(body) {
  const email = normalizeEmail(body?.email);
  const fieldErrors = {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (typeof body?.password !== "string" || body.password.length < 12 || Buffer.byteLength(body.password, "utf8") > 72) fieldErrors.password = "Use at least 12 characters and no more than 72 UTF-8 bytes.";
  for (const name of ["firstName", "lastName"]) if (body?.[name] != null && (typeof body[name] !== "string" || body[name].trim().length > 80)) fieldErrors[name] = "Use up to 80 characters.";
  return { email, fieldErrors, valid: Object.keys(fieldErrors).length === 0 };
}
module.exports = { normalizeEmail, validateRegistration };
