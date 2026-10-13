# TST Kentucky Platform — Administrative Guide

The platform has three parts, chosen to keep monthly hosting costs minimal (target: under $10/month total) while still being secure enough for a membership of 50–75 people.

## Architecture

| Component | What it does | Where it lives |
|---|---|---|
| Frontend (Vue.js) | The website members and admins see and click through — check-in map, poll voting screen, admin approval queue. | Cloudflare Pages (free hosting) |
| Backend (Node.js) | Handles logins, applies membership approvals, records check-ins, issues and counts ballots. | Fly.io — one small server |
| Database (SQLite) | Stores member accounts, check-in locations, poll results, and an audit log. Backed up automatically off-site. | A storage volume attached to the Fly.io server, backed up to Cloudflare R2 |

Estimated cost: roughly $2–$5/month for hosting, using the existing Fly.io account. No Google Maps billing risk — the check-in map uses free OpenStreetMap map tiles instead.

## Roles

| Role | Who | Access |
|---|---|---|
| Admin | Two designated admins | Log in with a physical FIDO2/YubiKey security key. Can approve or deny new member applications, open/close polls, and view the audit log. Cannot see how any individual member voted. |
| Congregation Member | Approved congregation members (~50–75 people) | Log in with a one-time emailed link (no password to remember or lose). Can set/update their own check-in location and vote in open polls but only once, receipt given. |

> Note: Admin accounts are intentionally the only accounts protected by hardware keys, since admins are the ones who can approve new accounts — that's the point in the system most worth protecting.

## Membership & Account Approval

New accounts are never self-serve. This is the core protection against outside people getting access.

1. A prospective member is given the (unlisted) application link by an existing member or admin.
2. They submit their name and email address only — no account is created yet.
3. The application appears in the Admin Queue, visible only after an admin logs in with their security key.
4. An admin approves or denies the application (ideally after some basic real-world vetting — e.g. confirming the person attends congregation, or checking with whoever referred them).
5. On approval, the applicant receives a one-time email link to activate their account. On denial, nothing further happens — the applicant is not notified of the reason.

> Note: The application link being unlisted (not linked anywhere public) is a helpful extra layer, but the approval step is the real gatekeeper — never rely on the link staying secret as the only protection.

## Admin Security Keys (FIDO2)

Each of the two admins carries a physical FIDO2 security key (e.g. YubiKey). Logging into the admin panel requires the physical key — there is no password fallback for admin accounts.

- If a key is lost or stolen, the remaining admin should immediately revoke it from the admin panel and issue a new key to that admin.
- If both keys are lost simultaneously, there is intentionally no backdoor recovery method — this is a deliberate trade-off to keep the admin layer un-phishable and un-forgeable. Recovering from a total loss requires direct developer intervention on the server itself.
- Because of the above, admins should register a second, backup key for themselves and store it somewhere physically separate and secure (e.g. a safe, a trusted third party) rather than relying on a single physical key.

> Note: This mirrors the policy already established for the project: 'if keys are lost there is no fail safe — we would rather everyone be safe and lose all information' than build in a recovery path that could be exploited.

## Voting Procedure

Polls are designed around one core rule: every eligible member gets exactly one vote, every vote that's cast is provably legitimate, and no vote can be tied back to the individual who cast it.

### Opening a poll

6. An admin creates the poll — choosing either **single-choice** (a plain Yes/No is just a single-choice poll with those two options) or **ranked-choice** (members rank their preferred options in order) — and sets an open/close window.
7. The admin can optionally mark the poll **required**. Required polls feed the attendance count described under "Attendance Tracking for Required Votes" below; it has no effect on how anyone votes or is counted.
8. The admin can optionally add a short description of what's being decided and attach reference documents (e.g. the full text of a motion) for members to read before they vote.
9. All approved members are notified that a poll is open.

### How a vote is cast

10. A member logs in and requests a ballot for the open poll. At this moment the system permanently records that this member has participated — this cannot later be denied or disputed by the member or the organization.
11. The member is issued a one-time, anonymous ballot token. This token is not linked to their identity in the vote records.
12. The member submits their answer (their single choice, or their ranked order of preference) along with the token, through a separate step that only ever sees the token — never the member's identity. They may add a short optional comment along with their vote.
13. **The member can reopen their ballot and change their answer for 30 minutes after they first submit.** Resubmitting isn't treated as double voting — it replaces their standing answer. Once 30 minutes have passed since their first submission, that member's vote is locked in.
14. The system checks the token is still valid for editing and records the vote in a tamper-evident log (each entry is cryptographically chained to the one before it, so any after-the-fact alteration — including the trail of a member's own edits — is detectable). Only a member's final answer counts toward the result; earlier drafts stay in the log for audit purposes but are never counted.

### Attendance tracking for required votes

For polls marked **required**, the system keeps a running, per-member count of required polls that member was eligible for but didn't participate in — pulled from the admin panel at any time. Reaching **three missed required votes** flags that member for the Adjacent-status review process. The system never changes anyone's status automatically; an admin always makes that call by hand after reviewing the flag.

This count is derived only from *whether* a member participated, never from *how* they voted — so it can't reveal anyone's vote choice, only their attendance.

### What this guarantees

| Guarantee | How |
|---|---|
| Only community members can vote | Ballot tokens are only issued to approved, logged-in members. |
| One person, one vote | Each member can request only one ballot token per poll — reopening and changing that same ballot within the 30-minute window is an edit, not a second vote. |
| Non-repudiation of participation | "Has this member voted?" is permanently and provably recorded — a member cannot later claim they didn't vote, nor can the organization falsely claim someone did. |
| Vote secrecy | The vote-choice record (and any optional comment) contains no link back to who cast it — not even admins can see how a specific member voted. Members should still avoid writing anything personally identifying in a comment, since that's a human risk no system can filter out. |
| Tamper evidence | The chained/hashed vote log makes silent after-the-fact edits to results detectable, including attempts to rewrite a member's vote history. |
| Accidental duplicate polls can't happen | If a page hangs or an admin double-clicks "Create poll," the system recognizes the repeat and returns the poll that already exists instead of creating a second one. |
