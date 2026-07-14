import { db } from "../db.js";
import { newId, issueLoginToken } from "../lib/tokens.js";
import { sendMail } from "../lib/mailer.js";
import { requireAdminStub } from "./admin-auth.js";

export default async function memberRoutes(app) {
  // Public (but unlisted-URL) application form
  app.post("/api/apply", async (req, reply) => {
    const { name, email } = req.body || {};
    if (!name || !email) return reply.code(400).send({ error: "name and email required" });

    const existing = db.prepare("SELECT id FROM applicants WHERE email = ?").get(email.toLowerCase().trim());
    if (existing) return { ok: true }; // don't reveal whether it's a duplicate

    db.prepare(
      "INSERT INTO applicants (id, name, email) VALUES (?, ?, ?)"
    ).run(newId(), name.trim(), email.toLowerCase().trim());

    return { ok: true };
  });

  // Admin: view pending applications
  app.get("/api/admin/applicants", { preHandler: requireAdminStub }, async () => {
    return db.prepare("SELECT * FROM applicants WHERE status = 'pending' ORDER BY created_at ASC").all();
  });

  // Admin: approve → creates the member account + emails an activation link
  app.post("/api/admin/applicants/:id/approve", { preHandler: requireAdminStub }, async (req, reply) => {
    const applicant = db.prepare("SELECT * FROM applicants WHERE id = ?").get(req.params.id);
    if (!applicant || applicant.status !== "pending") {
      return reply.code(404).send({ error: "not found or already decided" });
    }

    const memberId = newId();
    db.prepare("INSERT INTO members (id, name, email) VALUES (?, ?, ?)").run(
      memberId, applicant.name, applicant.email
    );
    db.prepare(
      "UPDATE applicants SET status = 'approved', decided_at = datetime('now') WHERE id = ?"
    ).run(applicant.id);

    const token = issueLoginToken(memberId, 60 * 24); // 24h to activate
    const link = `${process.env.FRONTEND_URL}/login/verify?token=${token}`;
    await sendMail(applicant.email, "You're approved — activate your TST KY account", `Welcome! Activate here: ${link}`);

    return { ok: true, memberId };
  });

  // Admin: deny — applicant is not notified why
  app.post("/api/admin/applicants/:id/deny", { preHandler: requireAdminStub }, async (req, reply) => {
    const result = db.prepare(
      "UPDATE applicants SET status = 'denied', decided_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: "not found or already decided" });
    return { ok: true };
  });
}
