import { db } from "../db.js";
import { newId } from "../lib/tokens.js";
import { createSession } from "../lib/sessions.js";

// Local-only shortcut for exercising the app without the real invite-email
// or admin-key dance. Only ever registered when DEV_LOGIN_ENABLED=true (see
// server.js) — never present at all otherwise, not just hidden.
export default async function devLoginRoutes(app) {
  app.post("/api/dev/login", async (req, reply) => {
    const { email, password } = req.body || {};

    if (email === process.env.DEV_ADMIN_EMAIL && password === process.env.DEV_ADMIN_PASSWORD) {
      // Admin "auth" today is just the shared stub key sent per request
      // (see routes/admin-auth.js) — hand it back so the frontend can act
      // as admin immediately instead of the member session system.
      return { ok: true, role: "admin", adminKey: process.env.ADMIN_STUB_KEY };
    }

    if (email === process.env.DEV_USER_EMAIL && password === process.env.DEV_USER_PASSWORD) {
      let member = db.prepare("SELECT * FROM members WHERE email = ?").get(email);
      if (!member) {
        const memberId = newId();
        db.prepare("INSERT INTO members (id, name, email) VALUES (?, ?, ?)").run(memberId, "Dev Test Member", email);
        member = { id: memberId };
      } else {
        db.prepare("UPDATE members SET active = 1 WHERE id = ?").run(member.id);
      }

      const session = createSession(member.id);
      reply.setCookie("sid", session.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        signed: true,
        expires: new Date(session.expiresAt),
      });
      return { ok: true, role: "member" };
    }

    return reply.code(401).send({ error: "invalid dev credentials" });
  });
}
