import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import {
  newId,
  issueLoginToken,
  consumeLoginToken,
  issueInviteToken,
  consumeInviteToken,
  issueBallotToken,
  getEditableBallotToken,
  markBallotTokenUsed,
  appendVote,
  verifyChain,
} from "../src/lib/tokens.js";
import { createMember } from "./helpers/app.js";

function createPoll() {
  const id = newId();
  db.prepare("INSERT INTO polls (id, question, options_json) VALUES (?, ?, ?)").run(
    id, "Test?", JSON.stringify(["A", "B"])
  );
  return id;
}

test("login token: valid once, then rejected", () => {
  const memberId = createMember();
  const token = issueLoginToken(memberId);
  assert.equal(consumeLoginToken(token), memberId);
  assert.equal(consumeLoginToken(token), null);
});

test("login token: expired token is rejected", () => {
  const token = issueLoginToken(createMember(), -1);
  assert.equal(consumeLoginToken(token), null);
});

test("login token: unknown token is rejected", () => {
  assert.equal(consumeLoginToken("nope"), null);
});

test("invite token: valid once, then rejected; expired rejected", () => {
  const invitationId = newId();
  db.prepare("INSERT INTO invitations (id, email) VALUES (?, ?)").run(invitationId, `${invitationId}@test.local`);
  const token = issueInviteToken(invitationId);
  assert.equal(consumeInviteToken(token), invitationId);
  assert.equal(consumeInviteToken(token), null);
  assert.equal(consumeInviteToken(issueInviteToken(invitationId, -1)), null);
});

test("ballot token: editable inside the window, for its own poll only", () => {
  const pollId = createPoll();
  const token = issueBallotToken(pollId);
  assert.equal(getEditableBallotToken(token, pollId, 30)?.token, token);
  assert.equal(getEditableBallotToken(token, createPoll(), 30), null);
});

test("ballot token: not editable once the window has passed", () => {
  const pollId = createPoll();
  const token = issueBallotToken(pollId);
  db.prepare("UPDATE ballot_tokens SET issued_at = datetime('now', '-31 minutes') WHERE token = ?").run(token);
  assert.equal(getEditableBallotToken(token, pollId, 30), null);
  assert.ok(getEditableBallotToken(token, pollId, 60), "still inside a longer window");
});

test("ballot token: marking used does not block re-voting", () => {
  const pollId = createPoll();
  const token = issueBallotToken(pollId);
  markBallotTokenUsed(token);
  assert.equal(db.prepare("SELECT used FROM ballot_tokens WHERE token = ?").get(token).used, 1);
  assert.ok(getEditableBallotToken(token, pollId, 30));
});

test("vote chain: first vote links to genesis, later votes to the previous hash", () => {
  const pollId = createPoll();
  const v1 = appendVote(pollId, "A");
  const v2 = appendVote(pollId, "B", "a comment", issueBallotToken(pollId));
  const rows = db.prepare("SELECT id, prev_hash, hash FROM votes WHERE poll_id = ? ORDER BY rowid").all(pollId);
  assert.equal(rows[0].prev_hash, "genesis");
  assert.equal(rows[1].prev_hash, v1.hash);
  assert.equal(rows[1].hash, v2.hash);
  assert.deepEqual(verifyChain(pollId), { valid: true, count: 2 });
});

test("vote chain: chains are per poll", () => {
  const p1 = createPoll();
  const p2 = createPoll();
  appendVote(p1, "A");
  appendVote(p2, "A");
  const first = db.prepare("SELECT prev_hash FROM votes WHERE poll_id = ?").get(p2);
  assert.equal(first.prev_hash, "genesis");
});

test("vote chain: empty poll verifies as valid with zero votes", () => {
  assert.deepEqual(verifyChain(createPoll()), { valid: true, count: 0 });
});

test("vote chain: editing a past vote's choice is detected", () => {
  const pollId = createPoll();
  appendVote(pollId, "A");
  const target = appendVote(pollId, "A");
  appendVote(pollId, "B");
  db.prepare("UPDATE votes SET choice_json = ? WHERE id = ?").run(JSON.stringify("B"), target.id);
  assert.deepEqual(verifyChain(pollId), { valid: false, brokenAt: target.id });
});

test("vote chain: editing a past comment is detected", () => {
  const pollId = createPoll();
  const v = appendVote(pollId, "A", "original");
  db.prepare("UPDATE votes SET comment = 'forged' WHERE id = ?").run(v.id);
  assert.equal(verifyChain(pollId).valid, false);
});

test("vote chain: deleting a past vote is detected at the next row", () => {
  const pollId = createPoll();
  appendVote(pollId, "A");
  const removed = appendVote(pollId, "B");
  const after = appendVote(pollId, "A");
  db.prepare("DELETE FROM votes WHERE id = ?").run(removed.id);
  assert.deepEqual(verifyChain(pollId), { valid: false, brokenAt: after.id });
});

test("vote chain: ranked (array) choices hash and verify", () => {
  const pollId = createPoll();
  appendVote(pollId, ["B", "A"], null, issueBallotToken(pollId));
  assert.equal(verifyChain(pollId).valid, true);
});
