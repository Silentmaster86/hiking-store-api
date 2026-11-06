CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  hits BIGINT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(expires_at);
