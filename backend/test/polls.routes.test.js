// Route-level tests for the voting flow, run in-process via app.inject().
import "./helpers/setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import pollRoutes from "../src/routes/polls.js";
import { buildApp, createMember, loginCookie, ADMIN, inMinutes } from "./helpers/app.js";

let app;
before(async () => { app = await buildApp(pollRoutes); });
after(() => app.close());

async function createPoll(overrides = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/polls",
    headers: ADMIN,
    payload: { question: "Pick one", options: ["A", "B", "C"], closesAt: inMinutes(60), ...overrides },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().id;
}

async function requestBallot(pollId, cookies) {
  return app.inject({ method: "POST", url: `/api/polls/${pollId}/request-ballot`, cookies });
}

async function vote(pollId, ballotToken, choice, comment) {
  return app.inject({ method: "POST", url: `/api/polls/${pollId}/vote`, payload: { ballotToken, choice, comment } });
}

// Logs in a new member, takes a ballot, casts `choice`. Returns the token + receipt.
async function castVote(pollId, choice) {
  const cookies = loginCookie(app, createMember());
  const ballot = (await requestBallot(pollId, cookies)).json();
  const res = await vote(pollId, ballot.ballotToken, choice);
  assert.equal(res.statusCode, 200, res.body);
  return { token: ballot.ballotToken, receipt: res.json().receiptHash, cookies };
}

// --- poll creation ---------------------------------------------------------

test("creating a poll requires the admin key", async () => {
  const res = await app.inject({ method: "POST", url: "/api/admin/polls", payload: {} });
  assert.equal(res.statusCode, 401);
});

test("poll creation validates its input", async () => {
  const cases = [
    [{ options: ["A"] }, /at least 2 options/],
    [{ question: "" }, /at least 2 options/],
    [{ votingMethod: "approval" }, /votingMethod/],
    [{ documents: "file.pdf" }, /documents must be an array/],
    [{ closesAt: undefined }, /closesAt .* is required/],
    [{ closesAt: "not a date" }, /closesAt .* is required/],
    [{ opensAt: "not a date" }, /opensAt is not a valid/],
    [{ opensAt: inMinutes(120), closesAt: inMinutes(60) }, /after opensAt/],
    [{ opensAt: inMinutes(-120), closesAt: inMinutes(-60) }, /in the future/],
  ];
  for (const [overrides, error] of cases) {
    const res = await app.inject({
      method: "POST", url: "/api/admin/polls", headers: ADMIN,
      payload: { question: "Q", options: ["A", "B"], closesAt: inMinutes(60), ...overrides },
    });
    assert.equal(res.statusCode, 400, JSON.stringify(overrides));
    assert.match(res.json().error, error);
  }
});

test("a retried create with the same Idempotency-Key makes only one poll", async () => {
  const send = () => app.inject({
    method: "POST", url: "/api/admin/polls",
    headers: { ...ADMIN, "idempotency-key": "create-once" },
    payload: { question: "Idempotent?", options: ["Yes", "No"], closesAt: inMinutes(60) },
  });
  const [a, b] = [(await send()).json(), (await send()).json()];
  assert.equal(a.id, b.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM polls WHERE question = 'Idempotent?'").get().n, 1);
});

test("the eligible-member snapshot is taken at creation and only includes active members", async () => {
  const active = createMember();
  const inactive = createMember({ active: 0 });
  const pollId = await createPoll();
  const lateJoiner = createMember();
  const eligible = db.prepare("SELECT member_id FROM poll_eligible_members WHERE poll_id = ?").all(pollId).map(r => r.member_id);
  assert.ok(eligible.includes(active));
  assert.ok(!eligible.includes(inactive));
  assert.ok(!eligible.includes(lateJoiner));
});

// --- listing & phases ------------------------------------------------------

test("listing polls requires login", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/polls" })).statusCode, 401);
});

test("a poll past its closes_at is auto-closed and drops off the list", async () => {
  const pollId = await createPoll();
  db.prepare("UPDATE polls SET closes_at = ? WHERE id = ?").run(inMinutes(-1), pollId);
  const res = await app.inject({ method: "GET", url: "/api/polls", cookies: loginCookie(app, createMember()) });
  assert.ok(!res.json().some(p => p.id === pollId));
  assert.equal(db.prepare("SELECT status FROM polls WHERE id = ?").get(pollId).status, "closed");
});

test("an upcoming poll is listed with phase 'upcoming' but refuses ballots", async () => {
  const pollId = await createPoll({ opensAt: inMinutes(30), closesAt: inMinutes(90) });
  const cookies = loginCookie(app, createMember());
  const listed = (await app.inject({ method: "GET", url: "/api/polls", cookies })).json().find(p => p.id === pollId);
  assert.equal(listed.phase, "upcoming");
  const res = await requestBallot(pollId, cookies);
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /hasn't opened/);
});

// --- ballots & voting ------------------------------------------------------

test("requesting a ballot needs login, and a member gets only one", async () => {
  const pollId = await createPoll();
  assert.equal((await requestBallot(pollId, {})).statusCode, 401);

  const cookies = loginCookie(app, createMember());
  const first = await requestBallot(pollId, cookies);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().votingMethod, "single");
  assert.equal((await requestBallot(pollId, cookies)).statusCode, 409);
});

test("requesting a ballot for an unknown poll is a 404", async () => {
  const res = await requestBallot("no-such-poll", loginCookie(app, createMember()));
  assert.equal(res.statusCode, 404);
});

test("the ballot token is not linked to the member anywhere in the DB", async () => {
  const pollId = await createPoll();
  const memberId = createMember();
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, memberId))).json();
  const tokenRow = db.prepare("SELECT * FROM ballot_tokens WHERE token = ?").get(ballotToken);
  assert.ok(!Object.values(tokenRow).includes(memberId));
  assert.ok(db.prepare("SELECT 1 FROM poll_participation WHERE poll_id = ? AND member_id = ?").get(pollId, memberId));
});

test("votes are validated against the poll's options", async () => {
  const pollId = await createPoll();
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, createMember()))).json();
  assert.equal((await vote(pollId, ballotToken, "Z")).statusCode, 400);
  assert.equal((await vote(pollId, "bogus-token", "A")).statusCode, 400);
  assert.equal((await vote(pollId, undefined, "A")).statusCode, 400);
  assert.equal((await vote(pollId, ballotToken, "A", 42)).statusCode, 400);
});

test("comments are trimmed, capped at 500 chars, and blank becomes null", async () => {
  const pollId = await createPoll();
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, createMember()))).json();
  const latestComment = () =>
    db.prepare("SELECT comment FROM votes WHERE ballot_token = ? ORDER BY rowid DESC LIMIT 1").get(ballotToken).comment;

  await vote(pollId, ballotToken, "A", "  hello  ");
  assert.equal(latestComment(), "hello");
  await vote(pollId, ballotToken, "A", "x".repeat(600));
  assert.equal(latestComment().length, 500);
  await vote(pollId, ballotToken, "A", "   ");
  assert.equal(latestComment(), null);
});

test("changing a vote inside the edit window replaces it in the tally", async () => {
  const pollId = await createPoll();
  const { token, receipt: firstReceipt } = await castVote(pollId, "A");
  const second = await vote(pollId, token, "B");
  assert.equal(second.statusCode, 200);

  const results = (await app.inject({ method: "GET", url: `/api/admin/polls/${pollId}/results`, headers: ADMIN })).json();
  assert.equal(results.totalVotes, 1);
  assert.deepEqual(results.counts, { B: 1 });
  assert.equal(results.chain.valid, true);
  assert.equal(results.chain.count, 2, "both revisions stay in the append-only log");

  const old = (await app.inject({ method: "GET", url: `/api/polls/${pollId}/verify-receipt?hash=${firstReceipt}` })).json();
  assert.equal(old.found, true);
  assert.equal(old.current, false);
  const now = (await app.inject({ method: "GET", url: `/api/polls/${pollId}/verify-receipt?hash=${second.json().receiptHash}` })).json();
  assert.equal(now.current, true);
});

test("voting after the edit window has closed is rejected", async () => {
  const pollId = await createPoll();
  const { token } = await castVote(pollId, "A");
  db.prepare("UPDATE ballot_tokens SET issued_at = datetime('now', '-31 minutes') WHERE token = ?").run(token);
  const res = await vote(pollId, token, "B");
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /edit window/);
});

test("my-ballot shows the current choice and whether it can still be edited", async () => {
  const pollId = await createPoll();
  const { token } = await castVote(pollId, "C");
  const mine = (await app.inject({ method: "GET", url: `/api/polls/${pollId}/my-ballot?token=${token}` })).json();
  assert.equal(mine.hasVoted, true);
  assert.equal(mine.choice, "C");
  assert.equal(mine.editable, true);

  db.prepare("UPDATE ballot_tokens SET issued_at = datetime('now', '-31 minutes') WHERE token = ?").run(token);
  const later = (await app.inject({ method: "GET", url: `/api/polls/${pollId}/my-ballot?token=${token}` })).json();
  assert.equal(later.editable, false);
});

test("the edit deadline never extends past the poll's close time", async () => {
  const closesAt = inMinutes(10); // sooner than the 30-minute edit window
  const pollId = await createPoll({ closesAt });
  const ballot = (await requestBallot(pollId, loginCookie(app, createMember()))).json();
  assert.equal(ballot.editableUntil, closesAt);
});

test("voting on a closed poll is rejected", async () => {
  const pollId = await createPoll();
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, createMember()))).json();
  await app.inject({ method: "POST", url: `/api/admin/polls/${pollId}/close`, headers: ADMIN });
  const res = await vote(pollId, ballotToken, "A");
  assert.equal(res.statusCode, 403);
});

// --- ranked choice ---------------------------------------------------------

test("ranked ballots reject non-arrays, unknown options and duplicates", async () => {
  const pollId = await createPoll({ votingMethod: "ranked" });
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, createMember()))).json();
  assert.equal((await vote(pollId, ballotToken, "A")).statusCode, 400);
  assert.equal((await vote(pollId, ballotToken, [])).statusCode, 400);
  assert.equal((await vote(pollId, ballotToken, ["A", "Z"])).statusCode, 400);
  assert.equal((await vote(pollId, ballotToken, ["A", "A"])).statusCode, 400);
  assert.equal((await vote(pollId, ballotToken, ["B"])).statusCode, 200, "partial rankings are allowed");
});

test("closing a ranked poll runs instant-runoff over the final ballots", async () => {
  const pollId = await createPoll({ votingMethod: "ranked" });
  for (const ranking of [["A"], ["A"], ["B"], ["B"], ["C", "A"]]) await castVote(pollId, ranking);

  const res = await app.inject({ method: "POST", url: `/api/admin/polls/${pollId}/close`, headers: ADMIN });
  const results = res.json();
  assert.equal(results.method, "ranked");
  assert.equal(results.totalVotes, 5);
  assert.equal(results.winner, "A");
  assert.equal(results.rounds.length, 2);
  assert.equal(results.chain.valid, true);
});

// --- results & integrity ---------------------------------------------------

test("public results are hidden while open and published once closed", async () => {
  const pollId = await createPoll();
  await castVote(pollId, "A");
  await castVote(pollId, "B");
  await castVote(pollId, "A");

  const whileOpen = await app.inject({ method: "GET", url: `/api/polls/${pollId}/public-results` });
  assert.equal(whileOpen.statusCode, 403);

  await app.inject({ method: "POST", url: `/api/admin/polls/${pollId}/close`, headers: ADMIN });
  const closed = (await app.inject({ method: "GET", url: `/api/polls/${pollId}/public-results` })).json();
  assert.deepEqual(closed.counts, { A: 2, B: 1 });
  assert.equal(closed.ledger.length, 3);
  assert.equal(closed.question, "Pick one");
});

test("closing or reading results for an unknown poll is a 404", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/polls/nope/close", headers: ADMIN })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/polls/nope/results", headers: ADMIN })).statusCode, 404);
});

test("the public verify endpoint flags a tampered vote log", async () => {
  const pollId = await createPoll();
  await castVote(pollId, "A");
  await castVote(pollId, "B");
  assert.equal((await app.inject({ method: "GET", url: `/api/polls/${pollId}/verify` })).json().valid, true);

  db.prepare("UPDATE votes SET choice_json = ? WHERE poll_id = ? AND choice_json = ?").run('"A"', pollId, '"B"');
  assert.equal((await app.inject({ method: "GET", url: `/api/polls/${pollId}/verify` })).json().valid, false);
});

test("verify-receipt reports unknown hashes as not found", async () => {
  const pollId = await createPoll();
  const res = await app.inject({ method: "GET", url: `/api/polls/${pollId}/verify-receipt?hash=deadbeef` });
  assert.deepEqual(res.json(), { found: false });
});

test("missed-vote report counts required, closed polls the member didn't take a ballot for", async () => {
  const voter = createMember();
  const absentee = createMember();
  const pollId = await createPoll({ required: true });
  const { ballotToken } = (await requestBallot(pollId, loginCookie(app, voter))).json();
  await vote(pollId, ballotToken, "A");
  await app.inject({ method: "POST", url: `/api/admin/polls/${pollId}/close`, headers: ADMIN });

  const misses = (await app.inject({ method: "GET", url: "/api/admin/participation/misses", headers: ADMIN })).json();
  const byId = Object.fromEntries(misses.map(m => [m.memberId, m]));
  assert.equal(byId[absentee]?.missed, 1);
  assert.equal(byId[absentee]?.atRisk, false);
  assert.equal(byId[voter], undefined);
});
