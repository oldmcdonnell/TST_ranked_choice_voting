import "./setup.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { db } from "../../src/db.js";
import { newId } from "../../src/lib/tokens.js";
import { createSession } from "../../src/lib/sessions.js";

export const ADMIN = { "x-admin-key": "test-admin-key" };

// A minimal app with just the plugins under test — no listen(), requests
// go through app.inject() in-process.
export async function buildApp(...routePlugins) {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: process.env.SESSION_SECRET });
  for (const plugin of routePlugins) await app.register(plugin);
  await app.ready();
  return app;
}

export function createMember({ name = "Test Member", email, active = 1 } = {}) {
  const id = newId();
  db.prepare("INSERT INTO members (id, name, email, active) VALUES (?, ?, ?, ?)").run(
    id, name, email || `${id}@test.local`, active
  );
  return id;
}

// Signed "sid" cookie for a fresh session, ready to pass to inject().
export function loginCookie(app, memberId) {
  const { id } = createSession(memberId);
  return { sid: app.signCookie(id) };
}

export const inMinutes = m => new Date(Date.now() + m * 60_000).toISOString();
