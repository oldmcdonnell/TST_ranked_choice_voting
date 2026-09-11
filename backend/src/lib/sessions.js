import { nanoid } from "nanoid";
import { db } from "../db.js";

// Idle-expiry window. Members only ever need to be logged in long enough
// to cast a ballot (or finish an application/check-in) — not for weeks at
// a stretch — so this defaults short. Override via SESSION_HOURS in .env.
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 4;
const SESSION_MS = SESSION_HOURS * 60 * 60_000;

export function createSession(memberId) {
  const id = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, member_id, expires_at) VALUES (?, ?, ?)").run(
    id, memberId, expiresAt
  );
  return { id, expiresAt };
}

// Returns the member_id for a valid, unexpired session — or null.
// Also silently "touches" (extends) the session so active users don't
// get logged out mid-use, without needing a fixed absolute expiry.
export function getMemberFromSession(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }
  const newExpiry = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(newExpiry, sessionId);
  return row.member_id;
}

export function destroySession(sessionId) {
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

// Housekeeping — call occasionally (e.g. on server start) to clear
// long-expired/used rows instead of letting these tables grow forever.
// Covers real login sessions plus the various single-use tokens
// (magic-link logins, congregation invites, spent ballot tokens).
export function pruneExpiredSessions() {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.prepare("DELETE FROM login_tokens WHERE used = 1 OR expires_at < ?").run(now);
  db.prepare("DELETE FROM invite_tokens WHERE used = 1 OR expires_at < ?").run(now);
  db.prepare("DELETE FROM ballot_tokens WHERE used = 1").run();
}
