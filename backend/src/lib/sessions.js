import { db } from "../db.js";

// Clears out used/expired single-use tokens so these tables don't grow
// forever. Called once at boot — fine for a congregation-sized deployment,
// no cron needed.
export function pruneExpiredSessions() {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM login_tokens WHERE used = 1 OR expires_at < ?").run(now);
  db.prepare("DELETE FROM invite_tokens WHERE used = 1 OR expires_at < ?").run(now);
  db.prepare("DELETE FROM ballot_tokens WHERE used = 1").run();
}
