import crypto from "node:crypto";

// STUB: admin authentication.
//
// For the real build, replace this whole file with WebAuthn/FIDO2 using
// @simplewebauthn/server — register each admin's security key against
// the admin_credentials table, then require a signed assertion on every
// admin request. See the admin_credentials table in schema.sql, which
// already has the shape (credential_id, public_key, counter) that
// library expects.
//
// For now, this is a single shared passcode (set ADMIN_STUB_KEY in .env)
// so the rest of the app has something to build and test against.
// DO NOT ship this stub to production — it has none of the properties
// (phishing resistance, per-admin revocation) that FIDO2 gives you.


import { nanoid } from "nanoid";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { db } from "../db.js";

const RP_NAME = process.env.RP_NAME || "TST Kentucky Admin";
const RP_ID = process.env.RP_ID || "localhost";
const ORIGIN = process.env.ORIGIN || "http://localhost:5173";
const ADMIN_SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS) || 8;
const CHALLENGE_MINUTES = 5;

function challengeId() {
  return nanoid(32);
}

function expiry(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function saveChallenge({ adminId = null, email = null, purpose, challenge }) {
  const id = challengeId();
  db.prepare("INSERT INTO webauthn_challenges (id, admin_id, email, purpose, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, adminId, email, purpose, challenge, expiry(CHALLENGE_MINUTES));
  return id;
}

function consumeChallenge(id, purpose) {
  const row = db.prepare("SELECT * FROM webauthn_challenges WHERE id = ? AND purpose = ?").get(id, purpose);
  if (!row || new Date(row.expires_at) < new Date()) return null;
  db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").run(id);
  return row;
}

function setAdminCookie(reply, adminId) {
  const id = nanoid(32);
  const expiresAt = expiry(ADMIN_SESSION_HOURS * 60);
  db.prepare("INSERT INTO admin_sessions (id, admin_id, expires_at) VALUES (?, ?, ?)").run(id, adminId, expiresAt);
  reply.setCookie("admin_sid", id, {
    httpOnly: true, sameSite: "lax", path: "/", signed: true, expires: new Date(expiresAt),
  });
}

function credentialDescriptor(row) {
  return {
    id: row.credential_id,
    publicKey: Buffer.from(row.public_key, "base64url"),
    counter: row.counter,
  };
}

export async function requireAdmin(req, reply) {
  const sessionId = req.unsignCookie(req.cookies?.admin_sid || "").value;
  const session = sessionId && db.prepare("SELECT * FROM admin_sessions WHERE id = ?").get(sessionId);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(sessionId);
    return reply.code(401).send({ error: "admin authentication required" });
  }
  req.adminId = session.admin_id;
}

export default async function adminAuthRoutes(app) {
  app.post("/api/admin/auth/register/options", async (req, reply) => {
    const { email, name, setupToken } = req.body || {};
    if (!process.env.ADMIN_SETUP_TOKEN || setupToken !== process.env.ADMIN_SETUP_TOKEN) {
      return reply.code(403).send({ error: "admin setup is not authorized" });
    }
    if (!email || !name) return reply.code(400).send({ error: "name and email required" });

    let admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(email.toLowerCase().trim());
    if (!admin) {
      admin = { id: nanoid(21), email: email.toLowerCase().trim(), name: name.trim() };
      db.prepare("INSERT INTO admins (id, name, email) VALUES (?, ?, ?)").run(admin.id, admin.name, admin.email);
    }
    const credentials = db.prepare("SELECT credential_id FROM admin_credentials WHERE admin_id = ?").all(admin.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID, userName: admin.email, userDisplayName: admin.name,
      userID: Buffer.from(admin.id),
      attestationType: "none",
      excludeCredentials: credentials.map(row => ({ id: row.credential_id })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    const id = saveChallenge({ adminId: admin.id, purpose: "registration", challenge: options.challenge });
    return { ...options, challengeId: id };
  });

  app.post("/api/admin/auth/register/verify", async (req, reply) => {
    const { challengeId, credential, label } = req.body || {};
    const challenge = consumeChallenge(challengeId, "registration");
    if (!challenge) return reply.code(400).send({ error: "registration challenge expired" });
    const verification = await verifyRegistrationResponse({
      response: credential, expectedChallenge: challenge.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    });
    if (!verification.verified) return reply.code(400).send({ error: "security key registration failed" });
    const info = verification.registrationInfo;
    db.prepare("INSERT INTO admin_credentials (id, admin_id, credential_id, public_key, counter, label) VALUES (?, ?, ?, ?, ?, ?)")
      .run(nanoid(21), challenge.admin_id, info.credential.id, Buffer.from(info.credential.publicKey).toString("base64url"), info.credential.counter, label || null);
    return { ok: true };
  });

  app.post("/api/admin/auth/login/options", async (req, reply) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(email);
    if (!admin) return reply.code(401).send({ error: "admin not found" });
    const credentials = db.prepare("SELECT credential_id FROM admin_credentials WHERE admin_id = ?").all(admin.id);
    if (!credentials.length) return reply.code(403).send({ error: "no security key registered" });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: "required", allowCredentials: credentials.map(row => ({ id: row.credential_id })),
    });
    const id = saveChallenge({ adminId: admin.id, email: admin.email, purpose: "authentication", challenge: options.challenge });
    return { ...options, challengeId: id };
  });

  app.post("/api/admin/auth/login/verify", async (req, reply) => {
    const { challengeId, credential } = req.body || {};
    const challenge = consumeChallenge(challengeId, "authentication");
    if (!challenge) return reply.code(400).send({ error: "login challenge expired" });
    const row = db.prepare("SELECT * FROM admin_credentials WHERE admin_id = ? AND credential_id = ?")
      .get(challenge.admin_id, credential?.id);
    if (!row) return reply.code(401).send({ error: "security key is not registered for this admin" });
    const verification = await verifyAuthenticationResponse({
      response: credential, expectedChallenge: challenge.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential: credentialDescriptor(row),
    });
    if (!verification.verified) return reply.code(401).send({ error: "security key authentication failed" });
    db.prepare("UPDATE admin_credentials SET counter = ? WHERE id = ?").run(verification.authenticationInfo.newCounter, row.id);
    setAdminCookie(reply, challenge.admin_id);
    return { ok: true };
  });

  app.post("/api/admin/auth/logout", async (req, reply) => {
    const sessionId = req.unsignCookie(req.cookies?.admin_sid || "").value;
    if (sessionId) db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(sessionId);
    reply.clearCookie("admin_sid", { path: "/" });
    return { ok: true };
  });
}
