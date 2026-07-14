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

export function requireAdminStub(req, reply, done) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_STUB_KEY) {
    reply.code(401).send({ error: "admin auth required (stub)" });
    return;
  }
  done();
}
