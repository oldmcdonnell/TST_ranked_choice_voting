import { nanoid } from "nanoid";
import crypto from "node:crypto";
import { db } from "../db.js";

export const newId = () => nanoid();

// Single-use login link tokens (magic link auth for members)
export function issueLoginToken(memberId, ttlMinutes = 15) {
  const token = nanoid(32);
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    "INSERT INTO login_tokens (token, member_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, memberId, expires);
  return token;
}

export function consumeLoginToken(token) {
  const row = db
    .prepare("SELECT * FROM login_tokens WHERE token = ? AND used = 0")
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  db.prepare("UPDATE login_tokens SET used = 1 WHERE token = ?").run(token);
  return row.member_id;
}

// Congregation invite confirmation tokens. Long-lived (default 30 days)
// since these go out in a batch and people don't all check email same-day.
export function issueInviteToken(invitationId, ttlMinutes = 60 * 24 * 30) {
  const token = nanoid(32);
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    "INSERT INTO invite_tokens (token, invitation_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, invitationId, expires);
  return token;
}

export function consumeInviteToken(token) {
  const row = db
    .prepare("SELECT * FROM invite_tokens WHERE token = ? AND used = 0")
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  db.prepare("UPDATE invite_tokens SET used = 1 WHERE token = ?").run(token);
  return row.invitation_id;
}

// Anonymous ballot tokens — deliberately never stored alongside member_id.
// The caller records poll_participation separately, at issuance time only.
export function issueBallotToken(pollId) {
  const token = nanoid(32);
  db.prepare(
    "INSERT INTO ballot_tokens (token, poll_id) VALUES (?, ?)"
  ).run(token, pollId);
  return token;
}

export function consumeBallotToken(token, pollId) {
  const row = db
    .prepare(
      "SELECT * FROM ballot_tokens WHERE token = ? AND poll_id = ? AND used = 0"
    )
    .get(token, pollId);
  if (!row) return false;
  db.prepare("UPDATE ballot_tokens SET used = 1 WHERE token = ?").run(token);
  return true;
}

// Hash-chained vote log: each new vote's hash depends on the previous
// vote's hash, so tampering with an old row breaks every hash after it.
export function appendVote(pollId, choice) {
  const last = db
    .prepare(
      "SELECT hash FROM votes WHERE poll_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
    )
    .get(pollId);
  const prevHash = last ? last.hash : "genesis";
  const id = nanoid();
  const payload = JSON.stringify({ id, pollId, choice, prevHash });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  db.prepare(
    `INSERT INTO votes (id, poll_id, choice_json, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, pollId, JSON.stringify(choice), prevHash, hash);

  return { id, hash };
}

// Recompute the chain from scratch and compare — call this to verify
// nobody has edited a past vote row.
export function verifyChain(pollId) {
  const rows = db
    .prepare(
      "SELECT id, choice_json, prev_hash, hash FROM votes WHERE poll_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(pollId);

  let expectedPrev = "genesis";
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) return { valid: false, brokenAt: row.id };
    const payload = JSON.stringify({
      id: row.id,
      pollId,
      choice: JSON.parse(row.choice_json),
      prevHash: row.prev_hash,
    });
    const recomputed = crypto.createHash("sha256").update(payload).digest("hex");
    if (recomputed !== row.hash) return { valid: false, brokenAt: row.id };
    expectedPrev = row.hash;
  }
  return { valid: true, count: rows.length };
}
