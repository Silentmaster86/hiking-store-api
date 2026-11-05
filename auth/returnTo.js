function safeReturnTo(value, origin) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}
module.exports = { safeReturnTo };
