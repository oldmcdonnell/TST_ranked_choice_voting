import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import {
  createSession,
  getMemberFromSession,
  destroySession,
  sessionCookieOptions,
  pruneExpiredSessions,
} from "../src/lib/sessions.js";
import { issueLoginToken } from "../src/lib/tokens.js";
import { createMember } from "./helpers/app.js";

const past = () => new Date(Date.now() - 60_000).toISOString();

test("a new session resolves to its member and expires ~SESSION_HOURS out", () => {
  const memberId = createMember();
  const { id, expiresAt } = createSession(memberId);
  assert.equal(getMemberFromSession(id), memberId);
  const hours = (new Date(expiresAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 3.99 && hours <= 4, `expected ~4h, got ${hours}`);
});

test("missing or unknown session id returns null", () => {
  assert.equal(getMemberFromSession(null), null);
  assert.equal(getMemberFromSession(""), null);
  assert.equal(getMemberFromSession("does-not-exist"), null);
});

test("an expired session returns null and is deleted", () => {
  const { id } = createSession(createMember());
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(past(), id);
  assert.equal(getMemberFromSession(id), null);
  assert.equal(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id), undefined);
});

test("using a session slides its expiry forward", () => {
  const { id } = createSession(createMember());
  const soon = new Date(Date.now() + 60_000).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(soon, id);
  getMemberFromSession(id);
  const { expires_at } = db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(id);
  assert.ok(new Date(expires_at) > new Date(Date.now() + 3 * 3_600_000));
});

test("destroySession logs the session out", () => {
  const { id } = createSession(createMember());
  destroySession(id);
  assert.equal(getMemberFromSession(id), null);
  assert.doesNotThrow(() => destroySession(undefined));
});

test("cookie options: lax + not secure in dev", () => {
  const expiresAt = new Date().toISOString();
  const opts = sessionCookieOptions(expiresAt);
  assert.deepEqual(opts, {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", signed: true, expires: new Date(expiresAt),
  });
});

test("cookie options: SameSite=None + Secure in production", (t) => {
  process.env.NODE_ENV = "production";
  t.after(() => delete process.env.NODE_ENV);
  const opts = sessionCookieOptions(new Date().toISOString());
  assert.equal(opts.sameSite, "none");
  assert.equal(opts.secure, true);
  assert.equal(opts.httpOnly, true);
});

test("pruneExpiredSessions removes expired sessions and spent/expired login tokens only", () => {
  const memberId = createMember();
  const live = createSession(memberId).id;
  const dead = createSession(memberId).id;
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(past(), dead);

  const liveToken = issueLoginToken(memberId);
  const usedToken = issueLoginToken(memberId);
  const expiredToken = issueLoginToken(memberId, -1);
  db.prepare("UPDATE login_tokens SET used = 1 WHERE token = ?").run(usedToken);

  pruneExpiredSessions();

  const sessionIds = db.prepare("SELECT id FROM sessions").all().map(r => r.id);
  assert.ok(sessionIds.includes(live));
  assert.ok(!sessionIds.includes(dead));

  const tokens = db.prepare("SELECT token FROM login_tokens").all().map(r => r.token);
  assert.ok(tokens.includes(liveToken));
  assert.ok(!tokens.includes(usedToken));
  assert.ok(!tokens.includes(expiredToken));
});
