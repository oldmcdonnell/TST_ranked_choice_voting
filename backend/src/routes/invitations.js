import { db } from "../db.js";
import { newId, issueInviteToken, consumeInviteToken } from "../lib/tokens.js";
import { sendMail } from "../lib/mailer.js";
import { requireAdminStub } from "./admin-auth.js";
import { createSession } from "../lib/sessions.js";

const INVITE_TTL_MINUTES = 60 * 24 * 30; // 30 days to confirm

export default async function invitationRoutes(app) {
  // Admin: paste/upload a batch of congregation emails. Re-running with the
  // same list is safe — already-confirmed people are skipped, still-pending
  // ones just get a fresh 30-day link.
  app.post("/api/admin/invitations", { preHandler: requireAdminStub }, async (req, reply) => {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) {
      return reply.code(400).send({ error: "emails array required" });
    }

    const results = [];
    for (const raw of emails) {
      const email = String(raw || "").toLowerCase().trim();
      if (!email || !email.includes("@")) {
        results.push({ email: raw, status: "skipped-invalid" });
        continue;
      }

      const existingMember = db.prepare("SELECT id FROM members WHERE email = ?").get(email);
      if (existingMember) {
        results.push({ email, status: "skipped-already-member" });
        continue;
      }

      let invitation = db.prepare("SELECT * FROM invitations WHERE email = ?").get(email);
      if (invitation && invitation.status === "confirmed") {
        results.push({ email, status: "skipped-already-confirmed" });
        continue;
      }
      if (!invitation) {
        invitation = { id: newId(), email };
        db.prepare(
          "INSERT INTO invitations (id, email, status) VALUES (?, ?, 'pending')"
        ).run(invitation.id, email);
      }

      const token = issueInviteToken(invitation.id, INVITE_TTL_MINUTES);
      const link = `${process.env.FRONTEND_URL}/invite/confirm?token=${token}`;
      await sendMail(
        email,
        "Confirm your invitation to vote — TST Kentucky",
        `You've been invited to join TST Kentucky's voting roll.\n\nConfirm here: ${link}\n\nThis link expires in 30 days.`
      );
      results.push({ email, status: "sent" });
    }

    return { ok: true, results };
  });

  // Admin: see invitation status (pending / confirmed) for the whole batch.
  app.get("/api/admin/invitations", { preHandler: requireAdminStub }, async () => {
    return db.prepare("SELECT * FROM invitations ORDER BY invited_at DESC").all();
  });

  // Public: recipient clicks their confirm link, gives their name, and
  // becomes an active member — logged in immediately via the same signed,
  // expiring session system as a normal magic-link login (NOT a raw
  // member-id cookie — see lib/sessions.js).
  app.post("/api/invitations/confirm", async (req, reply) => {
    const { token, name } = req.body || {};
    if (!token || !name) return reply.code(400).send({ error: "token and name required" });

    const invitationId = consumeInviteToken(token);
    if (!invitationId) return reply.code(400).send({ error: "invalid or expired invitation" });

    const invitation = db.prepare("SELECT * FROM invitations WHERE id = ?").get(invitationId);
    if (!invitation) return reply.code(400).send({ error: "invalid invitation" });

    let member = db.prepare("SELECT * FROM members WHERE email = ?").get(invitation.email);
    if (!member) {
      const memberId = newId();
      db.prepare("INSERT INTO members (id, name, email) VALUES (?, ?, ?)").run(
        memberId, name.trim(), invitation.email
      );
      member = { id: memberId };
    } else {
      db.prepare("UPDATE members SET active = 1 WHERE id = ?").run(member.id);
    }

    db.prepare(
      "UPDATE invitations SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?"
    ).run(invitation.id);

    const session = createSession(member.id);
    reply.setCookie("sid", session.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      signed: true,
      expires: new Date(session.expiresAt),
    });

    return { ok: true, memberId: member.id };
  });
}
