-- TST Kentucky platform schema
-- Notes:
--  * poll_participation proves WHO voted (non-repudiation of participation)
--  * votes proves WHAT was voted, keyed only by an anonymous ballot_token
--    (never by member_id) so choices can't be traced back to a person.

CREATE TABLE IF NOT EXISTS applicants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Real login sessions. The cookie only ever holds this table's `id`
-- (random, signed) — never a member_id directly — so a forged/guessed
-- cookie value can't be used to impersonate someone, and sessions expire
-- server-side regardless of what the browser does with the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Congregation-only voter invitations. Admin adds emails here in bulk;
-- each recipient confirms their own email before becoming a member.
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

-- Single-use, 30-day confirm links tied to an invitation.
CREATE TABLE IF NOT EXISTS invite_tokens (
  token TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Lets a client safely retry a write (e.g. after a timeout or a double
-- click) without creating a duplicate. Caller sends an Idempotency-Key
-- header; the same key replays the original response instead of re-running
-- the handler. Keyed per-key only (not per-route) — a given key is always
-- generated fresh per logical action by the caller.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per registered FIDO2/WebAuthn security key.
-- Admins should register a primary + backup key (see admin guide).
CREATE TABLE IF NOT EXISTS admin_credentials (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  label TEXT, -- e.g. "primary yubikey" / "backup yubikey"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  lat REAL,
  lng REAL,
  region TEXT, -- optional, stubbed in for later (e.g. 'western' | 'central' | 'eastern')
                -- not yet used for filtering/display — just captured for now
  visible INTEGER NOT NULL DEFAULT 0, -- opt-in, off by default
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  description TEXT, -- optional longer blurb explaining what's being voted on
  options_json TEXT NOT NULL, -- JSON array of option strings
  documents_json TEXT NOT NULL DEFAULT '[]', -- JSON array of filenames from data/documents/
  ranked_choice INTEGER NOT NULL DEFAULT 0, -- 0 = single choice (incl. Yes/No), 1 = ranked
  required INTEGER NOT NULL DEFAULT 0, -- counts toward the missed-required-vote rule
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closes_at TEXT
);

-- Proves a member participated. This is the non-repudiation record.
-- No vote content lives here.
CREATE TABLE IF NOT EXISTS poll_participation (
  poll_id TEXT NOT NULL REFERENCES polls(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, member_id)
);

-- Snapshot of who was an active member when a poll opened. Missed-vote
-- counting (poll_eligible_members minus poll_participation, for required +
-- closed polls) is judged against this snapshot rather than the current
-- roster, so later joins/departures can't retroactively change who "missed"
-- a given poll.
CREATE TABLE IF NOT EXISTS poll_eligible_members (
  poll_id TEXT NOT NULL REFERENCES polls(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY (poll_id, member_id)
);

-- Anonymous single-use ballots. Issued 1:1 against poll_participation
-- but stores no member_id itself.
CREATE TABLE IF NOT EXISTS ballot_tokens (
  token TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  used INTEGER NOT NULL DEFAULT 0
);

-- The actual vote content. Keyed only by ballot token. Hash-chained
-- so any after-the-fact tampering with the tally is detectable.
-- A vote row is never edited or deleted — changing your mind within the
-- edit window appends ANOTHER row carrying the same ballot_token, so the
-- hash chain stays pure append-only/tamper-evident. Tallying counts only
-- the most recent row per ballot_token; older rows stay in the chain as
-- history. ballot_token is safe to store here because it was never tied
-- to a member server-side (see ballot_tokens) — it only lets the ballot
-- that already holds the token find/amend its own prior rows.
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  ballot_token TEXT REFERENCES ballot_tokens(token),
  choice_json TEXT NOT NULL, -- e.g. "Option A" (single) or ["B","A","C"] (ranked)
  comment TEXT, -- optional, free text. Safe from a linkage standpoint only
                -- because this table is keyed by anonymous ballot_token,
                -- same as choice_json — voters should still avoid writing
                -- anything self-identifying in it.
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
