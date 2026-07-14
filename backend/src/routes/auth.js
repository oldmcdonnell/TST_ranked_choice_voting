import { db } from "../db.js";
import { issueLoginToken, consumeLoginToken } from "../lib/tokens.js";
import { sendMail } from "../lib/mailer.js";

export default async function authRoutes(app) {
  // Member requests a login link
  app.post("/api/auth/request-link", async (req, reply) => {
    const { email } = req.body || {};
    if (!email) return reply.code(400).send({ error: "email required" });

    const member = db
      .prepare("SELECT * FROM members WHERE email = ? AND active = 1")
      .get(email.toLowerCase().trim());

    // Always return the same response whether or not the email matches,
    // so this endpoint can't be used to enumerate members.
    if (member) {
      const token = issueLoginToken(member.id);
      const link = `${process.env.FRONTEND_URL}/login/verify?token=${token}`;
      await sendMail(member.email, "Your TST KY login link", `Click to log in: ${link}\n\nExpires in 15 minutes.`);
    }
    return { ok: true };
  });

  // Member clicks the link — exchange token for a session
  app.post("/api/auth/verify", async (req, reply) => {
    const { token } = req.body || {};
    const memberId = token && consumeLoginToken(token);
    if (!memberId) return reply.code(400).send({ error: "invalid or expired link" });

    // TODO: issue a real signed session cookie/JWT. Stubbed for now.
    reply.setCookie("session_member", memberId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return { ok: true, memberId };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    reply.clearCookie("session_member", { path: "/" });
    return { ok: true };
  });
}
