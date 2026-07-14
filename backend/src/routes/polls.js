import { db } from "../db.js";
import { newId, issueBallotToken, consumeBallotToken, appendVote, verifyChain } from "../lib/tokens.js";
import { requireAdminStub } from "./admin-auth.js";

function currentMember(req) {
  return req.cookies?.session_member || null;
}

export default async function pollRoutes(app) {
  // Admin: open a new poll (single-choice for now; ranked_choice comes later)
  app.post("/api/admin/polls", { preHandler: requireAdminStub }, async (req, reply) => {
    const { question, options, closesAt } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) {
      return reply.code(400).send({ error: "question and at least 2 options required" });
    }
    const id = newId();
    db.prepare(
      "INSERT INTO polls (id, question, options_json, closes_at) VALUES (?, ?, ?, ?)"
    ).run(id, question, JSON.stringify(options), closesAt || null);
    return { ok: true, id };
  });

  // Anyone logged in: list open polls
  app.get("/api/polls", async (req, reply) => {
    if (!currentMember(req)) return reply.code(401).send({ error: "login required" });
    const rows = db.prepare("SELECT id, question, options_json, status, closes_at FROM polls WHERE status = 'open'").all();
    return rows.map(r => ({ ...r, options: JSON.parse(r.options_json), options_json: undefined }));
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
