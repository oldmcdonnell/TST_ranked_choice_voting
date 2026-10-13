/*- Base URL of the backend server. Set VITE_API_URL in the frontend .env to
    point somewhere else; defaults to the local backend on port 8787. */
export const BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

/*- Shared helper that every call below goes through.
    - Sends the request to BASE + path.
    - credentials: "include" makes the browser send the login cookie ("sid"),
      which is how the backend knows who is logged in.
    - Adds a JSON Content-Type header whenever there is a body.
    - Checks the status: on any non-2xx response it throws an Error whose
      message is the backend's `error` text (e.g. "login required"), so
      callers can catch it and show it to the user.
    - On success, returns the parsed JSON response. */
async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  /* ---------------- Membership & login (backend: routes/members.js, routes/auth.js) ---------------- */

  /*- Connects to POST /api/apply. Submits a membership application
      (name + email) that lands in the admin's pending queue. No login needed. */
  apply: (name, email) => request("/api/apply", { method: "POST", body: JSON.stringify({ name, email }) }),

  /*- Connects to POST /api/auth/request-link. Asks the backend to email a
      one-time "magic link" login to this address. */
  requestLoginLink: (email) => request("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) }),

  /*- Connects to POST /api/auth/verify. Called when the member clicks the
      emailed link: trades the link's token for a login session, and the
      backend sets the "sid" cookie. */
  verifyLogin: (token) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),

  /*- Connects to POST /api/auth/logout. Ends the session and clears the cookie. */
  logout: () => request("/api/auth/logout", { method: "POST" }),

  /* ---------------- Polls & voting (backend: routes/polls.js) ---------------- */

  /*- Connects to GET /api/polls. Returns the list of open polls.
      Requires login: throws "login required" (401) if the cookie is missing
      or the session has expired. */
  polls: () => request("/api/polls"),

  /*- Connects to POST /api/polls/:id/request-ballot. Requires login.
      This is the ONLY step that links the member to the poll: the backend
      records that they participated, then hands back an anonymous ballot
      token used for the actual vote. Throws "already voted in this poll"
      (409) if this member already took a token. */
  requestBallot: (pollId) => request(`/api/polls/${pollId}/request-ballot`, { method: "POST" }),

  /*- Connects to POST /api/polls/:id/vote. Casts (or, within the edit
      window, re-casts) a vote using ONLY the anonymous ballot token, never
      the login, so the vote can't be traced back to a person.
      Returns { receiptHash, editableUntil }. */
  vote: (pollId, ballotToken, choice, comment) =>
    request(`/api/polls/${pollId}/vote`, { method: "POST", body: JSON.stringify({ ballotToken, choice, comment }) }),

  /*- Connects to GET /api/polls/:id/my-ballot. Looks up a ballot by its
      token (saved in this browser's localStorage), so a page reload can show
      the member's current choice, comment and receipt hash, and checks
      whether the edit window is still open. */
  myBallot: (pollId, token) => request(`/api/polls/${pollId}/my-ballot?token=${encodeURIComponent(token)}`),

  /*- Connects to GET /api/polls/:id/verify. Public check that the poll's
      hash-chained vote log hasn't been tampered with, without revealing
      who voted which way. */
  verifyChain: (pollId) => request(`/api/polls/${pollId}/verify`),

  /*- Connects to POST /api/polls/:id/email-receipt. Requires login.
      Checks the receipt hash is real for this poll, then emails it to the
      logged-in member. Writes nothing to the database, so no member-to-vote
      link is stored. */
  emailReceipt: (pollId, receiptHash) =>
    request(`/api/polls/${pollId}/email-receipt`, { method: "POST", body: JSON.stringify({ receiptHash }) }),

  /* ---------------- Check-ins (backend: routes/checkins.js) ---------------- */

  /*- Connects to POST /api/checkin. Requires login. Saves or updates the
      member's own location; `visible` controls whether other members can see
      it, and `region` is captured but not used for anything yet. */
  checkin: (lat, lng, visible, region) =>
    request("/api/checkin", { method: "POST", body: JSON.stringify({ lat, lng, visible, region }) }),

  /*- Connects to GET /api/checkins. Requires login. Lists members who chose
      to make their check-in visible. */
  checkins: () => request("/api/checkins"),

  /* ---------------- Admin (backend: routes/admin-auth.js checks the key) ----------------
     Every admin call sends the stub admin key in the "x-admin-key" header.
     The backend rejects requests without the right key with
     "admin auth required (stub)" (401). This key is a placeholder until
     WebAuthn replaces it. */

  /*- Connects to GET /api/admin/applicants. Lists pending membership applications. */
  adminApplicants: (adminKey) => request("/api/admin/applicants", { headers: { "x-admin-key": adminKey } }),

  /*- Connects to POST /api/admin/applicants/:id/approve. Turns the applicant
      into a member account and emails them an activation link. */
  adminApprove: (adminKey, id) =>
    request(`/api/admin/applicants/${id}/approve`, { method: "POST", headers: { "x-admin-key": adminKey } }),

  /*- Connects to POST /api/admin/applicants/:id/deny. Rejects the
      application; the applicant isn't told why. */
  adminDeny: (adminKey, id) =>
    request(`/api/admin/applicants/${id}/deny`, { method: "POST", headers: { "x-admin-key": adminKey } }),

  /*- Connects to POST /api/admin/polls (routes/polls.js). Creates a new poll
      (single-choice or ranked, optionally "required") and snapshots which
      members are eligible to vote in it right now.
      `idempotencyKey` is sent as the Idempotency-Key header. The caller
      (AdminQueue.vue) keeps the SAME key for one poll draft until it is
      created, so a double-click or retry replays the first response instead
      of creating a second poll (backend: lib/idempotency.js). */
  adminCreatePoll: (adminKey, idempotencyKey, question, options, description, documents, votingMethod, required) =>
    request("/api/admin/polls", {
      method: "POST",
      headers: {
        "x-admin-key": adminKey,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ question, options, description, documents, votingMethod, required }),
    }),

  /*- Connects to POST /api/admin/polls/:id/close (routes/polls.js). Closes
      voting on the poll and returns the final tally. */
  adminClosePoll: (adminKey, id) =>
    request(`/api/admin/polls/${id}/close`, { method: "POST", headers: { "x-admin-key": adminKey } }),

  /*- Connects to GET /api/admin/documents (routes/documents.js). Lists the
      files in the backend's documents folder, so the admin can attach them
      to a poll as reference material. */
  adminDocuments: (adminKey) =>
    request("/api/admin/documents", { headers: { "x-admin-key": adminKey } }),

  /* ---------------- Invitations (backend: routes/invitations.js) ---------------- */

  /*- Connects to POST /api/admin/invitations. Admin sends invite emails to a
      batch of addresses. Safe to re-run: already-confirmed people are
      skipped, and pending ones get a fresh 30-day link. */
  adminSendInvitations: (adminKey, emails) =>
    request("/api/admin/invitations", {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: JSON.stringify({ emails }),
    }),

  /*- Connects to GET /api/admin/invitations. Shows whether each invite is
      pending or confirmed. */
  adminInvitations: (adminKey) =>
    request("/api/admin/invitations", { headers: { "x-admin-key": adminKey } }),

  /*- Connects to POST /api/invitations/confirm. No login needed. The invitee
      clicks their link and enters their name; the backend makes them an
      active member and logs them in straight away by setting the "sid"
      cookie. */
  confirmInvitation: (token, name) =>
    request("/api/invitations/confirm", { method: "POST", body: JSON.stringify({ token, name }) }),

  /* ---------------- Dev only (backend: routes/dev-login.js) ---------------- */

  /*- Connects to POST /api/dev/login. That route only exists when the
      backend has DEV_LOGIN_ENABLED=true. Checks the email and password
      against the DEV_ADMIN_* or DEV_USER_* values in backend/.env.
      - For the dev admin: returns { role: "admin", adminKey }, and Home.vue
        saves the key in localStorage.
      - For the dev member: creates or reactivates the member and sets the
        "sid" login cookie, the same cookie a real login sets.
      Throws "invalid dev credentials" (401) when they don't match. */
  devLogin: (email, password) =>
    request("/api/dev/login", { method: "POST", body: JSON.stringify({ email, password }) }),
};
