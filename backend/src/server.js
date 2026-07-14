import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import authRoutes from "./routes/auth.js";
import memberRoutes from "./routes/members.js";
import checkinRoutes from "./routes/checkins.js";
import pollRoutes from "./routes/polls.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
});
await app.register(cookie);

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
