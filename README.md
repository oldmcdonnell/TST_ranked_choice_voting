# TST Kentucky Platform — Stub

Working skeleton replacing the Wix site: member applications, magic-link
login, opt-in check-in map, and anonymous one-person-one-vote polls.
This is a *stub* — enough real, tested logic to build on, not a finished
production app. See "Not done yet" below before going live.

## Stack
- **backend/** — Node + Fastify + better-sqlite3 (single file DB, no separate DB server to pay for)
- **frontend/** — Vue 3 + Vite + Leaflet (OpenStreetMap, no Google Maps billing)

## Prerequisites
- Node.js installed locally (Node 18+ is recommended for Vite and Fastify)
- One terminal for `backend`, one for `frontend`

## Environment
- Copy `backend/.env.example` to `backend/.env` and set `ADMIN_STUB_KEY` to a secret value for local testing
- Backend env values include `PORT`, `DB_PATH`, `SESSION_SECRET`, `FRONTEND_URL`, `MAIL_FROM`, and WebAuthn-related placeholders
- Frontend uses `VITE_API_URL` to point at the backend; it defaults to `http://localhost:8787`

## Running it locally

```bash
# backend
cd backend
cp .env.example .env        # then edit — set ADMIN_STUB_KEY to something only you know
npm install
npm run dev                 # http://localhost:8787

# frontend (separate terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Since there's no real email sending yet, "sent" emails (login links,
activation links) print to the **backend terminal** — copy the link from
there to test the flow.

## What's already working (tested end-to-end)
- Apply for membership → lands in admin queue
- Admin approves → member account created, activation link "emailed" (console)
- Member logs in via one-time link (no password)
- Admin opens a poll
- Member requests a ballot (records participation — the non-repudiation
  step) and casts a vote using only an anonymous token
- Double-voting is blocked
- Vote tally + hash-chain tamper check

## What you already have
Your current platform already contains several strong design decisions:
- Membership approval is separated from account activation.
- Login uses one-time links rather than stored passwords.
- Ballot participation is recorded separately from the anonymous vote.
- Anonymous ballot tokens prevent the vote from being directly tied to a member.
- Double voting is blocked.
- The vote log has a hash-chain integrity check.
- Location check-ins are opt-in.
- SQLite keeps early hosting and maintenance simple.

The central product message is:
> The platform verifies that each eligible member votes only once, while keeping the contents of their ballot separate from their identity.

That should be visible on the ballot request page, the review page, confirmation page, and the election integrity page.

## Not done yet — do before real go-live
1. **Admin auth is a placeholder.** `src/routes/admin-auth.js` currently
   checks a single shared passcode (`ADMIN_STUB_KEY`). Replace with real
   WebAuthn/FIDO2 using `@simplewebauthn/server` — the `admin_credentials`
   table in `schema.sql` already has the right shape for it. This is the
   most important thing to fix before this is usable for real.
2. **Real email sending.** `src/lib/mailer.js` just logs to console.
   Swap in a real provider (Resend, Postmark, SES) — the function
   signature won't need to change anywhere else.
3. **Session tokens are unsigned cookies.** Fine for local dev, not for
   production — swap for a signed/JWT session before deploying.
4. **Deploy targets**: backend → a small Fly.io machine with a persistent
   volume for the SQLite file (+ Litestream for off-site backups);
   frontend → Cloudflare Pages, pointed at the deployed backend via
   `VITE_API_URL`.
5. **Ranked-choice voting**: not built yet, by design — the `polls` table
   already has a `ranked_choice` flag reserved for it. When you're ready,
   the ballot payload becomes an ordered list instead of a single string,
   and the tally function gets an instant-runoff variant. The existing
   eligibility and anonymous-token flow can remain in place, but ranked-choice
   voting will also require additional validation rules, audit output, and
   ballot/tally structure.

## Project layout
```
backend/
  src/
    schema.sql        — all tables, with comments explaining the design
    db.js              — opens the SQLite file, applies schema
    lib/tokens.js       — login tokens, anonymous ballot tokens, hash chain
    lib/mailer.js        — email stub
    routes/auth.js        — member magic-link login
    routes/members.js      — apply / admin approve-deny
    routes/checkins.js      — opt-in location check-ins
    routes/polls.js           — poll creation, voting, tally, chain verify
    routes/admin-auth.js       — PLACEHOLDER, replace with WebAuthn
    server.js                   — wires it all together
frontend/
  src/
    views/                      — one file per page (Home, Apply, Login,
                                   CheckIn, Polls, AdminQueue)
    api.js                       — thin fetch wrapper for the backend
    router.js
```
