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
- Backend env values include `PORT`, `DB_PATH`, `SESSION_SECRET`, `SESSION_HOURS` (member login idle-expiry, default 4), `ADMIN_STUB_KEY`, `FRONTEND_URL`, `MAIL_FROM`, and WebAuthn-related placeholders (`RP_NAME`, `RP_ID`, `ORIGIN`)
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
- Sessions are signed, expiring cookies (4-hour idle expiry by default,
  tune via `SESSION_HOURS`) — a forged cookie value is rejected, logout
  actually invalidates the session. Kept short since the only real use
  case is logging in to cast one ballot, not staying signed in for weeks.
- Admin opens a poll — single-choice (incl. Yes/No) or ranked-choice, with
  an optional description blurb and attached reference documents (drop
  files into `backend/data/documents/`, pick them in the poll form), and
  an optional `required` flag for the missed-vote count below
- Poll eligibility is snapshotted into `poll_eligible_members` at creation
  time, so a member joining or leaving later can't retroactively change
  who that specific poll counted as eligible
- Member requests a ballot (records participation — the non-repudiation
  step) and casts a vote using only an anonymous token
- A cast vote can be revised for `BALLOT_EDIT_MINUTES` (default 30)
  after the first submission — each revision appends a new row rather
  than editing history, so the hash chain stays pure append-only; only
  the latest row per ballot counts toward the tally, but every edit
  stays in the log. A receipt hash reports whether it's still the
  counted ("current") vote or was superseded by a later edit.
- Optional free-text comment per ballot (length-capped) — stored only
  against the anonymous ballot token, same as the choice itself, so it
  carries the same anonymity guarantee (voters should still avoid
  writing anything self-identifying in it)
- Ranked-choice polls tally via instant-runoff, round by round; partial
  rankings are allowed (a ballot doesn't have to rank every option)
- Double-voting (a second *ballot token*) is blocked; changing your mind
  with the *same* token inside the edit window is not double-voting
- Vote tally + hash-chain tamper check
- Admin missed-required-vote report (`GET /api/admin/participation/misses`)
  — derived only from who was eligible vs. who participated, never touches
  vote content. Feeds the eventual three-missed-vote → Adjacent-status
  rule; today it's surfaced for manual admin review only, no automatic
  status change happens.
- Admin poll creation accepts an `Idempotency-Key` header so a retried or
  double-clicked request replays the original response instead of
  creating a second poll
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
5. **Voting-page UX still needs to catch up to the backend.** The backend
   fully supports ranked-choice ballots, editable/re-votable ballots, and
   comments (see above), but `frontend/src/views/Polls.vue` still only
   renders a single-page radio-button form per poll — no ranked-order
   input, no "reopen and change your vote" affordance, and no persisted
   ballot token, so a member can't actually revise a vote through the UI
   yet even though the API allows it. Planned shape: a landing page
   showing poll blurbs/documents + a "Start voting" button, leading to a
   lobby where each poll opens as its own panel (click to open, click
   away or the X to close), pre-filling the member's current choice from
   `GET /api/polls/:id/my-ballot` using a ballot token persisted in
   `localStorage` (so it survives a reload within the edit window).
6. **Richer poll lifecycle** (Draft → Scheduled → Open → Closed →
   Verified → Published) is a reasonable future upgrade, not yet built —
   current polls are just open/closed.
7. **Three-missed-required-vote → Adjacent status is not automated.**
   `GET /api/admin/participation/misses` surfaces the count; an admin
   still has to act on it manually. Automating the status transition
   itself is a deliberate choice to defer, not an oversight.
8. **Regional grouping for check-ins**: `region` is captured on check-in
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
    lib/idempotency.js    — replay-safe admin writes via Idempotency-Key
    lib/mailer.js           — email stub
    routes/auth.js           — member magic-link login
    routes/members.js         — apply / admin approve-deny
    routes/invitations.js      — admin bulk email-invite + confirm flow
    routes/checkins.js          — opt-in location + optional region
    routes/documents.js          — reference-document folder listing/serving
    routes/polls.js                — poll creation, voting (single/ranked,
                                     editable ballots), IRV tally, chain
                                     verify, missed-required-vote report
    routes/admin-auth.js            — PLACEHOLDER, replace with WebAuthn
    server.js                         — wires it all together
frontend/
  src/
    views/                           — Home, Apply, Login, LoginVerify,
                                       ConfirmInvite, CheckIn, Polls, AdminQueue
    api.js                            — thin fetch wrapper for the backend
    router.js
```
