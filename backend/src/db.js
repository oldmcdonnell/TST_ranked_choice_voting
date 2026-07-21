import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || "./data/tstky.sqlite";

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Lightweight migration: CREATE TABLE IF NOT EXISTS above won't retrofit
// columns onto a members table that already existed before this field
// was added. Add it here if missing so upgrades don't require wiping data.
const memberColumns = db.prepare("PRAGMA table_info(members)").all().map(c => c.name);
if (!memberColumns.includes("recognized")) {
  db.exec("ALTER TABLE members ADD COLUMN recognized INTEGER NOT NULL DEFAULT 0");
}
if (!memberColumns.includes("recognized_at")) {
  db.exec("ALTER TABLE members ADD COLUMN recognized_at TEXT");
}
