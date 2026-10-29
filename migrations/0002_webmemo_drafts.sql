-- MoatWatch Durable WebMemo Approval Drafts & Audit Trail (Cloudflare D1)
CREATE TABLE IF NOT EXISTS webmemo_drafts (
  draft_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_mask TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  expected_memo TEXT NOT NULL,
  expected_revision INTEGER NOT NULL DEFAULT 1,
  proposed_memo TEXT NOT NULL,
  analysis_summary TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  requested_by TEXT NOT NULL DEFAULT 'hermes',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  actor_discord_user_id TEXT,
  interaction_id TEXT,
  decision_idempotency_key TEXT,
  superseded_by_draft_id TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  readback_verified INTEGER NOT NULL DEFAULT 0,
  readback_hash TEXT,
  audit_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_webmemo_drafts_account_status
  ON webmemo_drafts (account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webmemo_drafts_idempotency
  ON webmemo_drafts (account_id, idempotency_key);
