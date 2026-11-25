import { db } from "../db.js";
import { newId, issueInviteToken, consumeInviteToken } from "../lib/tokens.js";
import { sendMail } from "../lib/mailer.js";
import { requireAdminStub } from "./admin-auth.js";
import { createSession, sessionCookieOptions } from "../lib/sessions.js";
import { autoClosePastDuePolls, pollPhase } from "./polls.js";

const INVITE_TTL_MINUTES = 60 * 24 * 30; // 30 days to confirm (when not tied to a poll)

// Timezone used when writing dates into invitation emails. Kentucky is
// mostly Eastern; set POLL_TIMEZONE=America/Chicago for a Central audience.
const POLL_TIMEZONE = process.env.POLL_TIMEZONE || "America/New_York";
function formatForEmail(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: POLL_TIMEZONE,
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

export default async function invitationRoutes(app) {
  // Admin: paste/upload a batch of congregation emails. Re-running with the
  // same list is safe — already-confirmed people are skipped, still-pending
  // ones just get a fresh 30-day link.
  app.post("/api/admin/invitations", { preHandler: requireAdminStub }, async (req, reply) => {
    const { emails, pollId } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) {
      return reply.code(400).send({ error: "emails array required" });
    }

    // Optional: invite people FOR a specific vote. The confirm link then
    // only works until that poll closes (instead of the default 30 days),
    // and the email names the poll and its voting window. Once someone
    // confirms they're a normal member and can vote in that poll and later
    // ones — only the unused invite link expires.
    let poll = null;
    let ttlMinutes = INVITE_TTL_MINUTES;
    if (pollId) {
      autoClosePastDuePolls();
      poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId);
      if (!poll) return reply.code(404).send({ error: "poll not found" });
      if (pollPhase(poll) === "closed") return reply.code(400).send({ error: "that poll has already closed" });
      if (!poll.closes_at) return reply.code(400).send({ error: "that poll has no close date to expire invites at" });
      ttlMinutes = Math.max(1, Math.floor((new Date(poll.closes_at).getTime() - Date.now()) / 60_000));
    }
    const linkExpiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

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

      const token = issueInviteToken(invitation.id, ttlMinutes);
      const link = `${process.env.FRONTEND_URL}/invite/confirm?token=${token}`;
      const body = poll
        ? `You've been invited to vote with TST Kentucky on:\n\n  ${poll.question}\n\n` +
          `Voting opens ${formatForEmail(poll.opens_at || poll.created_at)} and closes ${formatForEmail(poll.closes_at)}.\n\n` +
          `Confirm your invitation here: ${link}\n\nThis link stops working when voting closes.`
        : `You've been invited to join TST Kentucky's voting roll.\n\nConfirm here: ${link}\n\nThis link expires in 30 days.`;
      await sendMail(email, "Confirm your invitation to vote — TST Kentucky", body);
      results.push({ email, status: "sent", linkExpiresAt });
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
    reply.setCookie("sid", session.id, sessionCookieOptions(session.expiresAt));

    return { ok: true, memberId: member.id };
  });
}
