import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { withIdempotency } from "../src/lib/idempotency.js";
import { requireAdminStub } from "../src/routes/admin-auth.js";

test("withIdempotency: same key runs fn once and replays the result", () => {
  let calls = 0;
  const fn = () => ({ n: ++calls });
  assert.deepEqual(withIdempotency("key-1", fn), { n: 1 });
  assert.deepEqual(withIdempotency("key-1", fn), { n: 1 });
  assert.equal(calls, 1);
});

test("withIdempotency: different keys are independent", () => {
  let calls = 0;
  const fn = () => ({ n: ++calls });
  withIdempotency("key-a", fn);
  withIdempotency("key-b", fn);
  assert.equal(calls, 2);
});

test("withIdempotency: no key always runs fn", () => {
  let calls = 0;
  const fn = () => ++calls;
  withIdempotency(undefined, fn);
  withIdempotency("", fn);
  assert.equal(calls, 2);
});

// Minimal stand-ins for Fastify's req/reply/done.
function runAdminCheck(headers) {
  const reply = { statusCode: null, body: null, code(c) { this.statusCode = c; return this; }, send(b) { this.body = b; } };
  let passed = false;
  requireAdminStub({ headers }, reply, () => { passed = true; });
  return { passed, reply };
}

test("requireAdminStub: correct key passes", () => {
  assert.equal(runAdminCheck({ "x-admin-key": "test-admin-key" }).passed, true);
});

test("requireAdminStub: wrong, missing, or different-length key is a 401", () => {
  for (const headers of [{ "x-admin-key": "wrong-admin-key" }, {}, { "x-admin-key": "x" }]) {
    const { passed, reply } = runAdminCheck(headers);
    assert.equal(passed, false);
    assert.equal(reply.statusCode, 401);
  }
});

test("requireAdminStub: refuses everyone when ADMIN_STUB_KEY is unset", (t) => {
  const saved = process.env.ADMIN_STUB_KEY;
  delete process.env.ADMIN_STUB_KEY;
  t.after(() => { process.env.ADMIN_STUB_KEY = saved; });
  assert.equal(runAdminCheck({ "x-admin-key": "" }).passed, false);
  assert.equal(runAdminCheck({ "x-admin-key": "test-admin-key" }).passed, false);
});
