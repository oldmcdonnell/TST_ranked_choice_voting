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
  recognized INTEGER NOT NULL DEFAULT 0, -- admin has met this person in person; gates location sharing
  recognized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  visible INTEGER NOT NULL DEFAULT 0, -- opt-in, off by default
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL, -- JSON array of option strings
  ranked_choice INTEGER NOT NULL DEFAULT 0, -- 0 = single choice, 1 = ranked (later)
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
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  choice_json TEXT NOT NULL, -- e.g. "Option A" (single) or ["B","A","C"] (ranked, later)
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
