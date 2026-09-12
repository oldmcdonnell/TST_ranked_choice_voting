import { db } from "../db.js";
import { newId, issueBallotToken, consumeBallotToken, appendVote, verifyChain } from "../lib/tokens.js";
import { requireAdminStub } from "./admin-auth.js";
import { getMemberFromSession } from "../lib/sessions.js";
import { sendMail } from "../lib/mailer.js";

function currentMember(req) {
  const sessionId = req.unsignCookie(req.cookies?.sid || "").value;
  return getMemberFromSession(sessionId);
}

export default async function pollRoutes(app) {
  // Admin: open a new poll (single-choice for now; ranked_choice comes later)
  app.post("/api/admin/polls", { preHandler: requireAdminStub }, async (req, reply) => {
    const { question, description, options, documents, closesAt } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) {
      return reply.code(400).send({ error: "question and at least 2 options required" });
    }
    if (documents !== undefined && !Array.isArray(documents)) {
      return reply.code(400).send({ error: "documents must be an array of filenames" });
    }
    const id = newId();
    db.prepare(
      "INSERT INTO polls (id, question, description, options_json, documents_json, closes_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, question, description || null, JSON.stringify(options), JSON.stringify(documents || []), closesAt || null);
    return { ok: true, id };
  });

  // Anyone logged in: list open polls
  app.get("/api/polls", async (req, reply) => {
    if (!currentMember(req)) return reply.code(401).send({ error: "login required" });
    const rows = db.prepare("SELECT id, question, description, options_json, documents_json, status, closes_at FROM polls WHERE status = 'open'").all();
    return rows.map(r => ({
      ...r,
      options: JSON.parse(r.options_json),
      documents: JSON.parse(r.documents_json),
      options_json: undefined,
      documents_json: undefined,
    }));
  });

  // Member requests a ballot. This is the ONE place a member's identity
  // and the poll ever touch — it records participation, then hands back
  // an anonymous token that's used for the actual vote.
  app.post("/api/polls/:id/request-ballot", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    const poll = db.prepare("SELECT * FROM polls WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not open" });

    const already = db
      .prepare("SELECT 1 FROM poll_participation WHERE poll_id = ? AND member_id = ?")
      .get(poll.id, memberId);
    if (already) return reply.code(409).send({ error: "already voted in this poll" });

    // Record participation (non-repudiation) and issue the anonymous token
    // in the same transaction so they can't get out of sync.
    const token = db.transaction(() => {
      db.prepare(
        "INSERT INTO poll_participation (poll_id, member_id) VALUES (?, ?)"
      ).run(poll.id, memberId);
      return issueBallotToken(poll.id);
    })();

    return { ok: true, ballotToken: token, options: JSON.parse(poll.options_json) };
  });

  // Vote submission — deliberately takes ONLY the ballot token, never the
  // member's session/identity, so this table can never be joined back to
  // a person.
  app.post("/api/polls/:id/vote", async (req, reply) => {
    const { ballotToken, choice } = req.body || {};
    const poll = db.prepare("SELECT * FROM polls WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not open" });

    const options = JSON.parse(poll.options_json);
    if (!options.includes(choice)) return reply.code(400).send({ error: "invalid choice" });

    const okToken = ballotToken && consumeBallotToken(ballotToken, poll.id);
    if (!okToken) return reply.code(400).send({ error: "invalid or already-used ballot token" });

    const { hash } = appendVote(poll.id, choice);
    return { ok: true, receiptHash: hash };
  });

  // Admin: close a poll and get the tally
  app.post("/api/admin/polls/:id/close", { preHandler: requireAdminStub }, async (req, reply) => {
    db.prepare("UPDATE polls SET status = 'closed' WHERE id = ?").run(req.params.id);
    return tally(req.params.id);
  });

  app.get("/api/admin/polls/:id/results", { preHandler: requireAdminStub }, async (req) => {
    return tally(req.params.id);
  });

  // Anyone can verify the vote log hasn't been tampered with, without
  // seeing who voted which way.
  app.get("/api/polls/:id/verify", async (req) => {
    return verifyChain(req.params.id);
  });

  // Public: check a specific saved receipt hash against a poll. No login
  // required — possessing the hash IS the proof it's yours, same as a
  // paper voting receipt. Reveals only the choice tied to THAT hash (which
  // the voter already knows, since it's their own vote) plus whether the
  // overall chain is intact — never anything that identifies who cast it.
  app.get("/api/polls/:id/verify-receipt", async (req, reply) => {
    const { hash } = req.query || {};
    if (!hash) return reply.code(400).send({ error: "hash query param required" });

    const row = db
      .prepare("SELECT choice_json, created_at FROM votes WHERE poll_id = ? AND hash = ?")
      .get(req.params.id, hash);

    if (!row) return { found: false };

    return {
      found: true,
      choice: JSON.parse(row.choice_json),
      castAt: row.created_at,
      chain: verifyChain(req.params.id),
    };
  });

  // Public (once closed): the full recount ledger — every vote's hash and
  // choice, in cast order, plus the chain-integrity check. This is what a
  // saved receipt gets checked against for a real recount. Gated to closed
  // polls only, so live tallies aren't visible while voting is still open.
  app.get("/api/polls/:id/public-results", async (req, reply) => {
    const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not found" });
    if (poll.status !== "closed") {
      return reply.code(403).send({ error: "results are only public once the poll is closed" });
    }

    const rows = db
      .prepare("SELECT hash, choice_json, created_at FROM votes WHERE poll_id = ? ORDER BY created_at ASC, id ASC")
      .all(poll.id);

    const counts = {};
    const ledger = rows.map(r => {
      const choice = JSON.parse(r.choice_json);
      counts[choice] = (counts[choice] || 0) + 1;
      return { hash: r.hash, choice, castAt: r.created_at };
    });

    return {
      pollId: poll.id,
      question: poll.question,
      totalVotes: ledger.length,
      counts,
      ledger,
      chain: verifyChain(poll.id),
    };
  });

  // Member (must be logged in): email a copy of a receipt hash to
  // themselves. Deliberately does NOT write anything to the database —
  // this only reads a hash the client already has and re-verifies it's
  // real before emailing it, so no member<->vote link is ever stored.
  app.post("/api/polls/:id/email-receipt", async (req, reply) => {
    const memberId = currentMember(req);
    if (!memberId) return reply.code(401).send({ error: "login required" });

    const { receiptHash } = req.body || {};
    if (!receiptHash) return reply.code(400).send({ error: "receiptHash required" });

    const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not found" });

    const row = db
      .prepare("SELECT choice_json FROM votes WHERE poll_id = ? AND hash = ?")
      .get(poll.id, receiptHash);
    if (!row) return reply.code(400).send({ error: "that receipt hash wasn't found for this poll" });

    const member = db.prepare("SELECT email FROM members WHERE id = ?").get(memberId);
    if (!member) return reply.code(404).send({ error: "member not found" });

    await sendMail(
      member.email,
      `Your voting receipt — ${poll.question}`,
      `Keep this for your records. If there's ever a recount, this hash can be checked ` +
      `against the published results once the poll closes.\n\n` +
      `Poll: ${poll.question}\nReceipt hash: ${receiptHash}\n\n` +
      `This receipt does not reveal your identity — it only proves a vote matching this ` +
      `hash was recorded.`
    );

    return { ok: true };
  });

  function tally(pollId) {
    const votes = db.prepare("SELECT choice_json FROM votes WHERE poll_id = ?").all(pollId);
    const counts = {};
    for (const v of votes) {
      const choice = JSON.parse(v.choice_json);
      counts[choice] = (counts[choice] || 0) + 1;
    }
    return { pollId, totalVotes: votes.length, counts, chain: verifyChain(pollId) };
  }
}
