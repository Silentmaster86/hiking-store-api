function requestSecurity(origins) {
  return (req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" });
    const origin = req.get("Origin");
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: "This request origin is not allowed.", code: "ORIGIN_BLOCKED" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if ((!origin && req.get("Sec-Fetch-Site") === "cross-site") || req.get("X-Store-Request") !== "1") {
        return res.status(403).json({ error: "Refresh the page and try again.", code: "REQUEST_VERIFICATION_FAILED" });
      }
      if (["POST", "PUT", "PATCH"].includes(req.method) && !req.is("application/json")) {
        return res.status(415).json({ error: "Send a JSON request.", code: "JSON_REQUIRED" });
      }
    }
    next();
  };
}
module.exports = { requestSecurity };
