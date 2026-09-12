import { db } from "../db.js";

// Runs fn() and caches its return value under `key`. A later call with the
// same key returns the cached result instead of running fn() again, so a
// retried POST (network retry, double click) can't create a duplicate.
// With no key, always runs fn() — idempotency is opt-in per caller.
export function withIdempotency(key, fn) {
  if (!key) return fn();

  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE key = ?").get(key);
  if (existing) return JSON.parse(existing.response_json);

  const result = fn();
  db.prepare("INSERT INTO idempotency_keys (key, response_json) VALUES (?, ?)").run(key, JSON.stringify(result));
  return result;
}
