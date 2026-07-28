import { nanoid } from "nanoid";
import { db } from "../db.js";

const SESSION_DAYS = 30; // idle-expiry window — tune as you like

export function createSession(memberId) {
  const id = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();
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
  const newExpiry = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(newExpiry, sessionId);
  return row.member_id;
}

export function destroySession(sessionId) {
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

// Housekeeping — call occasionally (e.g. on server start) to clear
// long-expired rows instead of letting the table grow forever.
export function pruneExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}
