import { db } from "../db.js";

function currentMember(req) {
  return req.cookies?.session_member || null;
}

export default async function checkinRoutes(app) {
  // Member sets/updates their own location; opt-in visibility
  app.post("/api/checkin", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    const { lat, lng, visible } = req.body || {};

    if (visible) {
      const member = db.prepare("SELECT recognized FROM members WHERE id = ?").get(memberId);
      if (!member?.recognized) {
        return reply.code(403).send({ error: "not yet recognized by an admin — ask at a service to enable location sharing" });
      }
    }

    db.prepare(
      `INSERT INTO checkins (member_id, lat, lng, visible, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(member_id) DO UPDATE SET
         lat = excluded.lat, lng = excluded.lng,
         visible = excluded.visible, updated_at = datetime('now')`
    ).run(memberId, lat ?? null, lng ?? null, visible ? 1 : 0);

    return { ok: true };
  });

  // Any logged-in member can see who has opted to be visible
  app.get("/api/checkins", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    return db
      .prepare(
        `SELECT c.lat, c.lng, m.name, c.updated_at
         FROM checkins c JOIN members m ON m.id = c.member_id
         WHERE c.visible = 1`
      )
      .all();
  });
}
