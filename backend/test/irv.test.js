import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runIRV } from "../src/routes/polls.js";

const OPTIONS = ["A", "B", "C"];

test("outright first-round majority wins in one round", () => {
  const { winner, rounds } = runIRV([["A"], ["A"], ["B"]], OPTIONS);
  assert.equal(winner, "A");
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0], { counts: { A: 2, B: 1, C: 0 }, activeBallots: 3 });
});

test("eliminated option's ballots transfer to their next preference", () => {
  // Round 1: A2 B2 C1 → no majority, C out. Its ballot moves to A.
  const ballots = [["A"], ["A"], ["B"], ["B"], ["C", "A"]];
  const { winner, rounds } = runIRV(ballots, OPTIONS);
  assert.equal(winner, "A");
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].eliminated, "C");
  assert.deepEqual(rounds[1].counts, { A: 3, B: 2 });
});

test("a 50% plurality is not a majority", () => {
  const ballots = [["A"], ["A"], ["B", "C"], ["C", "B"]];
  const { winner, rounds } = runIRV(ballots, OPTIONS);
  // Round 1: A2 B1 C1 of 4 — 2 is not > 2, so no winner yet; B out.
  // Round 2: A2 C2 — tie, A out by option order; C wins.
  assert.equal(rounds[0].eliminated, "B");
  assert.deepEqual(rounds[1].counts, { A: 2, C: 2 });
  assert.equal(rounds[1].eliminated, "A");
  assert.equal(winner, "C");
});

test("exhausted ballots drop out of the active count", () => {
  // B is eliminated (tied last with C, broken by option order); the [B]
  // ballot ranked nothing else, so it's exhausted in round 2.
  const ballots = [["A"], ["A"], ["B"], ["C"]];
  const { winner, rounds } = runIRV(ballots, OPTIONS);
  assert.equal(rounds[0].activeBallots, 4);
  assert.equal(rounds[0].eliminated, "B");
  assert.equal(rounds[1].activeBallots, 3);
  assert.equal(winner, "A");
});

test("a tie for last place is flagged with tiedForLast", () => {
  const { rounds } = runIRV([["A"], ["A"], ["B"], ["C"]], OPTIONS);
  assert.deepEqual(rounds[0].tiedForLast, ["B", "C"]);
});

test("no tiedForLast key when last place is unique", () => {
  const { rounds } = runIRV([["A"], ["A"], ["B"], ["B"], ["C", "A"]], OPTIONS);
  assert.equal("tiedForLast" in rounds[0], false);
});

test("an even two-way split is decided by option order (documented limitation)", () => {
  // Characterization test: pins current behaviour so a change to the
  // tie-break policy is a deliberate, visible decision.
  const { winner, rounds } = runIRV([["A"], ["B"]], ["A", "B"]);
  assert.equal(rounds[0].eliminated, "A");
  assert.deepEqual(rounds[0].tiedForLast, ["A", "B"]);
  assert.equal(winner, "B");
});

test("no ballots means no winner (not the first-listed option)", () => {
  const { winner, rounds } = runIRV([], OPTIONS);
  assert.equal(winner, null);
  assert.deepEqual(rounds, [{ counts: { A: 0, B: 0, C: 0 }, activeBallots: 0 }]);
});

test("ballots ranking only unknown options count as exhausted", () => {
  const { winner } = runIRV([["Z"]], OPTIONS);
  assert.equal(winner, null);
});
