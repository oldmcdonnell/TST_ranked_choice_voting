// SQLite's datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no
// timezone marker, and `new Date()` parses that shape as LOCAL time — which
// silently shifted every deadline by the server's UTC offset (e.g. a
// 30-minute edit window became 5½ hours on a UTC-5 machine). Always go
// through this helper for timestamps read back out of the database.
// ISO strings that already carry a zone ("...Z", "+02:00") pass through.
export function parseDbTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

export function nowIso() {
  return new Date().toISOString();
}
