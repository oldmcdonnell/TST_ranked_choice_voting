import { db } from "../db.js";
import { getMemberFromSession } from "../lib/sessions.js";

function currentMember(req) {
  const sessionId = req.unsignCookie(req.cookies?.sid || "").value;
  return getMemberFromSession(sessionId);
}

export default async function checkinRoutes(app) {
  // Member sets/updates their own location; opt-in visibility.
  // `region` is optional and stubbed in for now (see schema.sql) — not
  // used for any filtering or grouping yet, just captured so the data
  // exists once region-based views are built.
  app.post("/api/checkin", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    const { lat, lng, visible, region } = req.body || {};
    db.prepare(
      `INSERT INTO checkins (member_id, lat, lng, region, visible, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(member_id) DO UPDATE SET
         lat = excluded.lat, lng = excluded.lng, region = excluded.region,
         visible = excluded.visible, updated_at = datetime('now')`
    ).run(memberId, lat ?? null, lng ?? null, region ?? null, visible ? 1 : 0);

    return { ok: true };
  });

  // Any logged-in member can see who has opted to be visible
  app.get("/api/checkins", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    return db
      .prepare(
        `SELECT c.lat, c.lng, c.region, m.name, c.updated_at
         FROM checkins c JOIN members m ON m.id = c.member_id
         WHERE c.visible = 1`
      )
      .all();
  });
}
