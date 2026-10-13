import { db } from "../db.js";
import {
  newId,
  issueBallotToken,
  getEditableBallotToken,
  markBallotTokenUsed,
  appendVote,
  verifyChain,
} from "../lib/tokens.js";
import { requireAdminStub } from "./admin-auth.js";
import { getMemberFromSession } from "../lib/sessions.js";
import { sendMail } from "../lib/mailer.js";
import { withIdempotency } from "../lib/idempotency.js";

// How long after a member's first vote they can still reopen the ballot
// and change their choice. Fixed from first vote, not reset per edit.
const BALLOT_EDIT_MINUTES = Number(process.env.BALLOT_EDIT_MINUTES) || 30;

function currentMember(req) {
  const sessionId = req.unsignCookie(req.cookies?.sid || "").value;
  return getMemberFromSession(sessionId);
}

function editableUntilFor(tokenRow) {
  return new Date(new Date(tokenRow.issued_at).getTime() + BALLOT_EDIT_MINUTES * 60_000).toISOString();
}

// Each edit within the window appends a new vote row rather than mutating
// an old one (see lib/tokens.js) — this collapses the append log down to
// one final row per ballot_token, which is what counts toward results.
// Legacy rows recorded before ballot_token existed (rare, pre-migration)
// have no token to group by, so each stands alone as its own final vote.
function latestVotesByToken(pollId) {
  const rows = db
    .prepare(
      "SELECT id, choice_json, comment, ballot_token, hash, created_at FROM votes WHERE poll_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(pollId);
  const latestByKey = new Map();
  let legacyIndex = 0;
  for (const row of rows) {
    const key = row.ballot_token || `legacy-${legacyIndex++}`;
    latestByKey.set(key, row); // later iterations overwrite earlier ones for the same token
  }
  return [...latestByKey.values()];
}

// Instant-runoff over the final ballots. Ballots may rank only some
// options (partial ranking) — a ballot's vote goes to its highest-ranked
// option that hasn't been eliminated yet, or is "exhausted" (counted in
// totalVotes but not in that round) once all its ranked options are gone.
function runIRV(ballots, options) {
  let remaining = [...options];
  const rounds = [];

  while (remaining.length > 1) {
    const counts = {};
    for (const c of remaining) counts[c] = 0;
    let activeCount = 0;

    for (const ballot of ballots) {
      const pick = ballot.find(choice => remaining.includes(choice));
      if (pick !== undefined) {
        counts[pick]++;
        activeCount++;
      }
    }

    const leader = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (activeCount === 0) {
      rounds.push({ counts, activeBallots: 0 });
      break;
    }
    if (leader[1] > activeCount / 2) {
      rounds.push({ counts, activeBallots: activeCount });
      return { winner: leader[0], rounds };
    }

    // Eliminate the lowest count; ties broken by option order (documented
    // limitation — a real tie here is a policy call, not something to
    // silently resolve one specific way without an admin knowing).
    let eliminated = remaining[0];
    for (const c of remaining) {
      if (counts[c] < counts[eliminated]) eliminated = c;
    }
    rounds.push({ counts, activeBallots: activeCount, eliminated });
    remaining = remaining.filter(c => c !== eliminated);
  }

  return { winner: remaining[0] ?? null, rounds };
}

function computeResults(pollId) {
  const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId);
  const finalVotes = latestVotesByToken(pollId);

  if (poll.ranked_choice) {
    const options = JSON.parse(poll.options_json);
    const ballots = finalVotes.map(v => JSON.parse(v.choice_json));
    const { winner, rounds } = runIRV(ballots, options);
    return { pollId, method: "ranked", totalVotes: finalVotes.length, winner, rounds, chain: verifyChain(pollId) };
  }

  const counts = {};
  for (const v of finalVotes) {
    const choice = JSON.parse(v.choice_json);
    counts[choice] = (counts[choice] || 0) + 1;
  }
  return { pollId, method: "single", totalVotes: finalVotes.length, counts, chain: verifyChain(pollId) };
}

export default async function pollRoutes(app) {
  // Admin: open a new poll — single-choice (incl. Yes/No) or ranked-choice,
  // optionally marked "required" for the missed-vote count. Snapshots the
  // currently-active membership into poll_eligible_members in the same
  // transaction, so later joins/departures can't change who this poll
  // counts as eligible.
  app.post("/api/admin/polls", { preHandler: requireAdminStub }, async (req, reply) => {
    const { question, description, options, documents, closesAt, votingMethod, required } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) {
      return reply.code(400).send({ error: "question and at least 2 options required" });
    }
    if (documents !== undefined && !Array.isArray(documents)) {
      return reply.code(400).send({ error: "documents must be an array of filenames" });
    }
    if (votingMethod !== undefined && votingMethod !== "single" && votingMethod !== "ranked") {
      return reply.code(400).send({ error: 'votingMethod must be "single" or "ranked"' });
    }
    const rankedChoice = votingMethod === "ranked" ? 1 : 0;

    // A retried/double-clicked "create poll" request replays the same
    // response instead of opening a second poll — pass an Idempotency-Key
    // header from the client to opt in.
    return withIdempotency(req.headers["idempotency-key"], () => {
      const id = newId();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO polls (id, question, description, options_json, documents_json, ranked_choice, required, closes_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, question, description || null, JSON.stringify(options), JSON.stringify(documents || []), rankedChoice, required ? 1 : 0, closesAt || null);

        const eligible = db.prepare("SELECT id FROM members WHERE active = 1").all();
        const insertEligible = db.prepare("INSERT INTO poll_eligible_members (poll_id, member_id) VALUES (?, ?)");
        for (const m of eligible) insertEligible.run(id, m.id);
      })();
      return { ok: true, id };
    });
  });

  // Anyone logged in: list open polls
  app.get("/api/polls", async (req, reply) => {
    if (!currentMember(req)) return reply.code(401).send({ error: "login required" });
    const rows = db
      .prepare(
        "SELECT id, question, description, options_json, documents_json, ranked_choice, required, status, closes_at FROM polls WHERE status = 'open'"
      )
      .all();
    return rows.map(r => ({
      id: r.id,
      question: r.question,
      description: r.description,
      options: JSON.parse(r.options_json),
      documents: JSON.parse(r.documents_json),
      votingMethod: r.ranked_choice ? "ranked" : "single",
      required: !!r.required,
      status: r.status,
      closes_at: r.closes_at,
    }));
  });

  // Member requests a ballot. This is the ONE place a member's identity
  // and the poll ever touch — it records participation, then hands back
  // an anonymous token that's used for the actual vote. The token stays
  // usable (re-votable) for BALLOT_EDIT_MINUTES from now, not single-use.
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
    const { token, issuedAt } = db.transaction(() => {
      db.prepare(
        "INSERT INTO poll_participation (poll_id, member_id) VALUES (?, ?)"
      ).run(poll.id, memberId);
      const token = issueBallotToken(poll.id);
      const row = db.prepare("SELECT issued_at FROM ballot_tokens WHERE token = ?").get(token);
      return { token, issuedAt: row.issued_at };
    })();

    return {
      ok: true,
      ballotToken: token,
      options: JSON.parse(poll.options_json),
      votingMethod: poll.ranked_choice ? "ranked" : "single",
      editableUntil: editableUntilFor({ issued_at: issuedAt }),
    };
  });

  // Reopen an existing ballot: given the token the member already holds
  // (persisted client-side), show their current choice and whether the
  // edit window is still open. Never looks anything up by member identity.
  app.get("/api/polls/:id/my-ballot", async (req, reply) => {
    const { token } = req.query || {};
    if (!token) return reply.code(400).send({ error: "token query param required" });

    const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not found" });

    const tokenRow = db.prepare("SELECT * FROM ballot_tokens WHERE token = ? AND poll_id = ?").get(token, poll.id);
    if (!tokenRow) return reply.code(404).send({ error: "ballot token not found for this poll" });

    const latest = db
      .prepare(
        "SELECT choice_json, comment FROM votes WHERE poll_id = ? AND ballot_token = ? ORDER BY created_at DESC, id DESC LIMIT 1"
      )
      .get(poll.id, token);

    const deadline = new Date(tokenRow.issued_at).getTime() + BALLOT_EDIT_MINUTES * 60_000;
    const editable = poll.status === "open" && Date.now() <= deadline;

    return {
      hasVoted: !!latest,
      choice: latest ? JSON.parse(latest.choice_json) : null,
      comment: latest ? latest.comment : null,
      votingMethod: poll.ranked_choice ? "ranked" : "single",
      options: JSON.parse(poll.options_json),
      editable,
      editableUntil: new Date(deadline).toISOString(),
    };
  });

  // Vote submission — deliberately takes ONLY the ballot token, never the
  // member's session/identity, so this table can never be joined back to
  // a person. Re-submitting the same token within its edit window appends
  // a new revision rather than being rejected as "already used".
  app.post("/api/polls/:id/vote", async (req, reply) => {
    const { ballotToken, choice, comment } = req.body || {};
    const poll = db.prepare("SELECT * FROM polls WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not open" });

    const options = JSON.parse(poll.options_json);
    if (poll.ranked_choice) {
      if (!Array.isArray(choice) || choice.length === 0) {
        return reply.code(400).send({ error: "ranked ballot must be a non-empty ordered array of choices" });
      }
      const seen = new Set();
      for (const c of choice) {
        if (!options.includes(c)) return reply.code(400).send({ error: `invalid option: ${c}` });
        if (seen.has(c)) return reply.code(400).send({ error: "duplicate option in ranking" });
        seen.add(c);
      }
    } else if (!options.includes(choice)) {
      return reply.code(400).send({ error: "invalid choice" });
    }

    let cleanComment = null;
    if (comment !== undefined && comment !== null) {
      if (typeof comment !== "string") return reply.code(400).send({ error: "comment must be a string" });
      cleanComment = comment.trim().slice(0, 500) || null;
    }

    const tokenRow = ballotToken && getEditableBallotToken(ballotToken, poll.id, BALLOT_EDIT_MINUTES);
    if (!tokenRow) {
      return reply.code(400).send({ error: "invalid ballot token, or the edit window has closed" });
    }

    const { hash } = appendVote(poll.id, choice, cleanComment, ballotToken);
    markBallotTokenUsed(ballotToken);
    return { ok: true, receiptHash: hash, editableUntil: editableUntilFor(tokenRow) };
  });

  // Admin: close a poll and get the tally
  app.post("/api/admin/polls/:id/close", { preHandler: requireAdminStub }, async (req, reply) => {
    db.prepare("UPDATE polls SET status = 'closed' WHERE id = ?").run(req.params.id);
    return computeResults(req.params.id);
  });

  app.get("/api/admin/polls/:id/results", { preHandler: requireAdminStub }, async (req) => {
    return computeResults(req.params.id);
  });

  // Admin: per-member count of missed REQUIRED, CLOSED polls, derived
  // purely from poll_eligible_members minus poll_participation — never
  // touches vote content, so this can't reveal how anyone voted, only
  // whether they showed up. Feeds the three-missed-vote review manually;
  // no automatic status change happens here.
  app.get("/api/admin/participation/misses", { preHandler: requireAdminStub }, async () => {
    const rows = db
      .prepare(
        `SELECT em.member_id AS memberId, m.name, m.email, COUNT(*) AS missed
         FROM poll_eligible_members em
         JOIN polls p ON p.id = em.poll_id AND p.required = 1 AND p.status = 'closed'
         JOIN members m ON m.id = em.member_id
         LEFT JOIN poll_participation pp ON pp.poll_id = em.poll_id AND pp.member_id = em.member_id
         WHERE pp.member_id IS NULL
         GROUP BY em.member_id
         ORDER BY missed DESC`
      )
      .all();
    return rows.map(r => ({ ...r, atRisk: r.missed >= 3 }));
  });

  // Anyone can verify the vote log hasn't been tampered with, without
  // seeing who voted which way.
  app.get("/api/polls/:id/verify", async (req) => {
    return verifyChain(req.params.id);
  });

  // Public: check a specific saved receipt hash against a poll. No login
  // required — possessing the hash IS the proof it's yours, same as a
  // paper voting receipt. Reveals only the choice tied to THAT hash (which
  // the voter already knows, since it's their own vote), whether it's
  // still their CURRENT vote (or was later superseded by an edit) plus
  // whether the overall chain is intact — never anything that identifies
  // who cast it.
  app.get("/api/polls/:id/verify-receipt", async (req, reply) => {
    const { hash } = req.query || {};
    if (!hash) return reply.code(400).send({ error: "hash query param required" });

    const row = db
      .prepare("SELECT choice_json, comment, ballot_token, created_at FROM votes WHERE poll_id = ? AND hash = ?")
      .get(req.params.id, hash);

    if (!row) return { found: false };

    let current = true;
    if (row.ballot_token) {
      const latest = db
        .prepare(
          "SELECT hash FROM votes WHERE poll_id = ? AND ballot_token = ? ORDER BY created_at DESC, id DESC LIMIT 1"
        )
        .get(req.params.id, row.ballot_token);
      current = latest?.hash === hash;
    }

    return {
      found: true,
      choice: JSON.parse(row.choice_json),
      comment: row.comment,
      castAt: row.created_at,
      current,
      chain: verifyChain(req.params.id),
    };
  });

  // Public (once closed): the full recount ledger — every FINAL vote's
  // hash and choice (superseded edits excluded), in cast order, plus the
  // chain-integrity check over the complete append log. Gated to closed
  // polls only, so live tallies aren't visible while voting is still open.
  app.get("/api/polls/:id/public-results", async (req, reply) => {
    const poll = db.prepare("SELECT * FROM polls WHERE id = ?").get(req.params.id);
    if (!poll) return reply.code(404).send({ error: "poll not found" });
    if (poll.status !== "closed") {
      return reply.code(403).send({ error: "results are only public once the poll is closed" });
    }

    const ledger = latestVotesByToken(poll.id).map(r => ({
      hash: r.hash,
      choice: JSON.parse(r.choice_json),
      castAt: r.created_at,
    }));

    const results = computeResults(poll.id);
    return { ...results, question: poll.question, ledger };
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
}
