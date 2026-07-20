import crypto from "node:crypto";

/**
 * DEVELOPMENT-ONLY ADMIN AUTHENTICATION
 *
 * This temporary middleware protects admin routes with a shared passcode
 * supplied through the `x-admin-key` request header.
 *
 * Replace this implementation with WebAuthn/FIDO2 before production:
 * - Register each administrator's security key.
 * - Store credential metadata in the `admin_credentials` table.
 * - Verify WebAuthn authentication assertions during admin login.
 * - Issue a secure, HttpOnly admin session cookie after authentication.
 *
 * Do not deploy this shared-key implementation to production.
 */

const ADMIN_AUTH_ERROR = {
  error: "admin authentication required",
};

export function requireAdminStub(request, reply, done) {
  const suppliedKey = request.headers["x-admin-key"];
  const expectedKey = process.env.ADMIN_STUB_KEY;

  if (!expectedKey) {
    request.log.error("ADMIN_STUB_KEY is not configured");

    reply.code(500).send({
      error: "admin authentication is not configured",
    });

    return;
  }

  if (typeof suppliedKey !== "string") {
    reply.code(401).send(ADMIN_AUTH_ERROR);
    return;
  }

  const suppliedBuffer = Buffer.from(suppliedKey, "utf8");
  const expectedBuffer = Buffer.from(expectedKey, "utf8");

  const keysMatch =
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

  if (!keysMatch) {
    reply.code(401).send(ADMIN_AUTH_ERROR);
    return;
  }

  done();
}