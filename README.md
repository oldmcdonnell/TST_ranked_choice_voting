# TST Kentucky Platform — Stub

Working skeleton replacing the Wix site: member applications, congregation
email invites, magic-link login, opt-in check-in map, and anonymous
one-person-one-vote polls. This is a *stub* — enough real, tested logic to
build on, not a finished production app. See "Not done yet" below before
going live.

## Stack
- **backend/** — Node + Fastify + better-sqlite3 (single file DB, no separate DB server to pay for)
- **frontend/** — Vue 3 + Vite + Leaflet (OpenStreetMap, no Google Maps billing)

## Prerequisites
- Node.js installed locally (Node 18+ recommended for Vite and Fastify)
- One terminal for `backend`, one for `frontend`

## Environment
- Copy `backend/.env.example` to `backend/.env` and set `ADMIN_STUB_KEY` to a secret value for local testing
- Also set `SESSION_SECRET` in `backend/.env` — the server refuses to start without it (see "What's already working" below)
- Backend env values include `PORT`, `DB_PATH`, `SESSION_SECRET`, `ADMIN_STUB_KEY`, `FRONTEND_URL`, `MAIL_FROM`, and WebAuthn-related placeholders (`RP_NAME`, `RP_ID`, `ORIGIN`)
- Frontend uses `VITE_API_URL` to point at the backend; it defaults to `http://localhost:8787`

## Running it locally

```bash
# backend
cd backend
cp .env.example .env        # then edit — set ADMIN_STUB_KEY and SESSION_SECRET
npm install
npm run dev                 # http://localhost:8787

# frontend (separate terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Since there's no real email sending yet, "sent" emails (login links,
activation links, congregation invite links) print to the **backend
terminal** — copy the link from there to test the flow.

## What's already working (tested end-to-end)
- Apply for membership → lands in admin queue
- Admin approves → member account created, activation link "emailed" (console)
- Admin can bulk-invite congregation members by email — each recipient
  confirms their own email via a 30-day link and is logged in immediately
  (same signed-session system as a normal magic-link login, not a raw cookie)
- Member logs in via one-time link (no password)
- Sessions are signed, expiring cookies (30-day idle expiry) — a forged
  cookie value is rejected, logout actually invalidates the session
- Admin opens a poll
- Member requests a ballot (records participation — the non-repudiation
  step) and casts a vote using only an anonymous token
- Double-voting is blocked
- Vote tally + hash-chain tamper check
- The stub admin key is compared with `crypto.timingSafeEqual` to avoid
  a timing side-channel (still a stub — see below — just a safer one)
- Check-ins can optionally include a region (Western/Central/Eastern) —
  captured now, not yet used for any filtering or grouping (see below)

## Not done yet — do before real go-live
1. **Admin auth is still a placeholder**, despite the timing-safe compare
   above. `src/routes/admin-auth.js` checks a single shared passcode
   (`ADMIN_STUB_KEY`). Replace with real WebAuthn/FIDO2 using
   `@simplewebauthn/server` — the `admin_credentials` table in
   `schema.sql` already has the right shape for it. This is the most
   important thing to fix before this is usable for real.
2. **Real email sending.** `src/lib/mailer.js` just logs to console.
   Swap in a real provider (Resend, Postmark, SES) — the function
   signature won't need to change anywhere else.
3. **CSRF protection** and **secure cookie flags** (`Secure`, proper
   `SameSite` for your real deployed domain) — fine for local dev over
   plain http://localhost, not yet configured for a real HTTPS deploy.
4. **Deploy targets**: backend → a small Fly.io machine with a persistent
   volume for the SQLite file (+ Litestream for off-site backups);
   frontend → Cloudflare Pages, pointed at the deployed backend via
   `VITE_API_URL`.
5. **Ranked-choice voting**: not built yet, by design — the `polls` table
   already has a `ranked_choice` flag reserved for it. When you're ready,
   the ballot payload becomes an ordered list instead of a single string,
   and the tally function gets an instant-runoff variant. Nothing else
   in the schema or auth flow needs to change.
6. **Richer poll lifecycle** (Draft → Scheduled → Open → Closed →
   Verified → Published) and a multi-step voting UI (confirm eligibility
   → review → submit → confirmation) are reasonable future upgrades, not
   yet built — current polls are just open/closed, and voting is a
   single-page form.
7. **Regional grouping for check-ins**: `region` is captured on check-in
   (see `checkins.region` in schema.sql) but nothing reads it yet — no
   filtering, no map grouping/coloring. There's a reference map graphic
   (Western/Central/Eastern regions) to build toward when this gets
   picked up.

## Project layout
```
backend/
  src/
    schema.sql        — all tables, with comments explaining the design
    db.js              — opens the SQLite file, applies schema
    lib/tokens.js       — login, invite, and ballot tokens, hash chain
    lib/sessions.js      — signed session create/lookup/expire/destroy
    lib/mailer.js          — email stub
    routes/auth.js          — member magic-link login
    routes/members.js        — apply / admin approve-deny
    routes/invitations.js     — admin bulk email-invite + confirm flow
    routes/checkins.js         — opt-in location + optional region
    routes/polls.js              — poll creation, voting, tally, chain verify
    routes/admin-auth.js          — PLACEHOLDER, replace with WebAuthn
    server.js                       — wires it all together
frontend/
  src/
    views/                           — Home, Apply, Login, LoginVerify,
                                       ConfirmInvite, CheckIn, Polls, AdminQueue
    api.js                            — thin fetch wrapper for the backend
    router.js
```
