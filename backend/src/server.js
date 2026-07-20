import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import authRoutes from "./routes/auth.js";
import memberRoutes from "./routes/members.js";
import checkinRoutes from "./routes/checkins.js";
import pollRoutes from "./routes/polls.js";
import { pruneExpiredSessions } from "./lib/sessions.js";

const app = Fastify({ logger: true });

if (!process.env.SESSION_SECRET) {
  // Without a secret, @fastify/cookie silently skips signing/verifying
  // cookies at all — better to refuse to start than to run with auth
  // effectively disabled.
  console.error("Missing SESSION_SECRET in .env — refusing to start. Copy .env.example to .env first.");
  process.exit(1);
}
if (process.env.SESSION_SECRET === "change-me-dev-only") {
  app.log.warn("Using the placeholder SESSION_SECRET — fine for local dev, but set a real random value before deploying.");
}

await app.register(cors, {
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
});
await app.register(cookie, {
  secret: process.env.SESSION_SECRET, // enables signed cookies (req.unsignCookie)
});

pruneExpiredSessions();

await app.register(authRoutes);
await app.register(memberRoutes);
await app.register(checkinRoutes);
await app.register(pollRoutes);

app.get("/api/health", async () => ({ ok: true }));

const port = Number(process.env.PORT) || 8787;
app.listen({ port, host: "0.0.0.0" }).catch(err => {
  app.log.error(err);
  process.exit(1);
});