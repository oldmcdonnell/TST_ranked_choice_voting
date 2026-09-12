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

// A ballot token stays editable (re-votable) for editWindowMinutes after
// issuance — NOT single-use — so a member can reopen and change their mind.
// Returns the ballot_tokens row if it's valid for this poll and still
// inside the window, otherwise null. Never mutates the row: editability is
// purely a function of issued_at vs now, recomputed on every call.
export function getEditableBallotToken(token, pollId, editWindowMinutes) {
  const row = db
    .prepare("SELECT * FROM ballot_tokens WHERE token = ? AND poll_id = ?")
    .get(token, pollId);
  if (!row) return null;
  const deadline = new Date(row.issued_at).getTime() + editWindowMinutes * 60_000;
  if (Date.now() > deadline) return null;
  return row;
}

// Marks a token as having cast at least one vote — informational only
// (e.g. for admin visibility), never used to block re-voting.
export function markBallotTokenUsed(token) {
  db.prepare("UPDATE ballot_tokens SET used = 1 WHERE token = ?").run(token);
}

// Hash-chained vote log: each new vote's hash depends on the previous
// vote's hash, so tampering with an old row breaks every hash after it.
// Changing your mind within the edit window never edits a past row — it
// appends a new one carrying the same ballot_token. Tallying (see
// routes/polls.js) counts only the most recent row per token; the rest
// stay in the chain purely as history.
//
// The comment/ballotToken keys are only added to the hashed payload when
// present, so votes cast before those columns existed (payload had no such
// key at all) still verify correctly against their original hash.
// Comment content itself is assumed already validated/sanitized by the
// caller (see the vote route) — this function just hashes and stores it.
function votePayload({ id, pollId, choice, comment, ballotToken, prevHash }) {
  const payload = { id, pollId, choice };
  if (comment) payload.comment = comment;
  if (ballotToken) payload.ballotToken = ballotToken;
  payload.prevHash = prevHash;
  return JSON.stringify(payload);
}

export function appendVote(pollId, choice, comment = null, ballotToken = null) {
  const last = db
    .prepare(
      "SELECT hash FROM votes WHERE poll_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
    )
    .get(pollId);
  const prevHash = last ? last.hash : "genesis";
  const id = nanoid();
  const payload = votePayload({ id, pollId, choice, comment, ballotToken, prevHash });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  db.prepare(
    `INSERT INTO votes (id, poll_id, ballot_token, choice_json, comment, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, pollId, ballotToken, JSON.stringify(choice), comment, prevHash, hash);

  return { id, hash };
}

// Recompute the chain from scratch and compare — call this to verify
// nobody has edited a past vote row.
export function verifyChain(pollId) {
  const rows = db
    .prepare(
      "SELECT id, choice_json, comment, ballot_token, prev_hash, hash FROM votes WHERE poll_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(pollId);

  let expectedPrev = "genesis";
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) return { valid: false, brokenAt: row.id };
    const payload = votePayload({
      id: row.id,
      pollId,
      choice: JSON.parse(row.choice_json),
      comment: row.comment,
      ballotToken: row.ballot_token,
      prevHash: row.prev_hash,
    });
    const recomputed = crypto.createHash("sha256").update(payload).digest("hex");
    if (recomputed !== row.hash) return { valid: false, brokenAt: row.id };
    expectedPrev = row.hash;
  }
  return { valid: true, count: rows.length };
}
