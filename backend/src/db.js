import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve against the backend root (one level up from src/), not the
// process's CWD — otherwise a relative DB_PATH silently lands wherever
// the process happened to be launched from (e.g. a deploy platform's
// start command), not next to this project.
const dbPath = path.resolve(path.join(__dirname, ".."), process.env.DB_PATH || "./data/tstky.sqlite");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Minimal migration step: CREATE TABLE IF NOT EXISTS above only helps on a
// fresh DB — an existing tstky.sqlite from before a column was added needs
// it bolted on explicitly.
const pollColumns = db.prepare("PRAGMA table_info(polls)").all().map(c => c.name);
if (!pollColumns.includes("description")) {
  db.exec("ALTER TABLE polls ADD COLUMN description TEXT");
}
if (!pollColumns.includes("documents_json")) {
  db.exec("ALTER TABLE polls ADD COLUMN documents_json TEXT NOT NULL DEFAULT '[]'");
}
if (!pollColumns.includes("required")) {
  db.exec("ALTER TABLE polls ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
}
if (!pollColumns.includes("opens_at")) {
  db.exec("ALTER TABLE polls ADD COLUMN opens_at TEXT");
}

const voteColumns = db.prepare("PRAGMA table_info(votes)").all().map(c => c.name);
if (!voteColumns.includes("comment")) {
  db.exec("ALTER TABLE votes ADD COLUMN comment TEXT");
}
if (!voteColumns.includes("ballot_token")) {
  db.exec("ALTER TABLE votes ADD COLUMN ballot_token TEXT");
}
