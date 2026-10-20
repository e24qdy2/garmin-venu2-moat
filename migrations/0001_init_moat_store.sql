-- Venu2Moat Serverless Edge Persistent Store (Cloudflare D1)
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
