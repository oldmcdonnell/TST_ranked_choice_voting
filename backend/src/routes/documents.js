import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdminStub } from "./admin-auth.js";
import { getMemberFromSession } from "../lib/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reference documents (ballot text, candidate statements, etc.) live here.
// Stubbed as a plain folder an admin drops files into by hand — no upload
// endpoint yet. Attach one to a poll by filename from the admin poll form.
export const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || path.join(__dirname, "..", "..", "data", "documents");
fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export default async function documentRoutes(app) {
  // Admin: list files currently sitting in the documents folder, to pick
  // from when attaching reference material to a poll.
  app.get("/api/admin/documents", { preHandler: requireAdminStub }, async () => {
    return fs.readdirSync(DOCUMENTS_DIR).filter(name => !name.startsWith("."));
  });

  // Member (must be logged in, same as poll data): fetch one attached file
  // by name. Filename is resolved against the documents dir and checked to
  // still be inside it, so "../../whatever" can't escape the folder.
  app.get("/api/documents/:filename", async (req, reply) => {
    const sessionId = req.unsignCookie(req.cookies?.sid || "").value;
    if (!getMemberFromSession(sessionId)) return reply.code(401).send({ error: "login required" });

    const filePath = path.join(DOCUMENTS_DIR, path.basename(req.params.filename));
    if (!filePath.startsWith(DOCUMENTS_DIR) || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "document not found" });
    }

    const ext = path.extname(filePath).toLowerCase();
    reply.type(CONTENT_TYPES[ext] || "application/octet-stream");
    return fs.createReadStream(filePath);
  });
}
