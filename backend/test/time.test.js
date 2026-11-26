import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbTime, nowIso } from "../src/lib/time.js";

test("parseDbTime reads SQLite datetime('now') text as UTC, not local time", () => {
  assert.equal(parseDbTime("2026-03-01 12:30:00").toISOString(), "2026-03-01T12:30:00.000Z");
});

test("parseDbTime keeps fractional seconds", () => {
  assert.equal(parseDbTime("2026-03-01 12:30:00.250").toISOString(), "2026-03-01T12:30:00.250Z");
});

test("parseDbTime passes zoned ISO strings through unchanged", () => {
  assert.equal(parseDbTime("2026-03-01T12:30:00.000Z").toISOString(), "2026-03-01T12:30:00.000Z");
  assert.equal(parseDbTime("2026-03-01T12:30:00+02:00").toISOString(), "2026-03-01T10:30:00.000Z");
});

test("parseDbTime returns null for empty values and Dates as-is", () => {
  assert.equal(parseDbTime(null), null);
  assert.equal(parseDbTime(""), null);
  const d = new Date();
  assert.equal(parseDbTime(d), d);
});

test("nowIso returns a UTC ISO timestamp close to now", () => {
  const s = nowIso();
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(new Date(s).getTime() - Date.now()) < 1000);
});
