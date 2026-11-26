// Test environment. Import this FIRST in every test file (before anything
// that touches src/db.js): db.js opens the database at import time, and
// several modules read their env config at import time too.
//
// node --test runs each test file in its own process, so each file gets
// its own fresh, throwaway SQLite database here — tests never touch
// backend/data/ and never share state across files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tstky-test-"));

process.env.DB_PATH = path.join(dir, "test.sqlite");
process.env.SESSION_SECRET = "test-session-secret";
process.env.ADMIN_STUB_KEY = "test-admin-key";
process.env.SESSION_HOURS = "4";
process.env.BALLOT_EDIT_MINUTES = "30";
process.env.FRONTEND_URL = "http://localhost:5173";
delete process.env.RESEND_API_KEY; // mailer falls back to console, never sends
delete process.env.NODE_ENV;

process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
