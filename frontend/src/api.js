export const BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

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
  apply: (name, email) => request("/api/apply", { method: "POST", body: JSON.stringify({ name, email }) }),
  requestLoginLink: (email) => request("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) }),
  verifyLogin: (token) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  polls: () => request("/api/polls"),
  requestBallot: (pollId) => request(`/api/polls/${pollId}/request-ballot`, { method: "POST" }),
  vote: (pollId, ballotToken, choice, comment) =>
    request(`/api/polls/${pollId}/vote`, { method: "POST", body: JSON.stringify({ ballotToken, choice, comment }) }),
  myBallot: (pollId, token) => request(`/api/polls/${pollId}/my-ballot?token=${encodeURIComponent(token)}`),
  verifyChain: (pollId) => request(`/api/polls/${pollId}/verify`),

  checkin: (lat, lng, visible, region) =>
    request("/api/checkin", { method: "POST", body: JSON.stringify({ lat, lng, visible, region }) }),
  checkins: () => request("/api/checkins"),

  // Admin endpoints need the stub key until WebAuthn replaces this
  adminApplicants: (adminKey) => request("/api/admin/applicants", { headers: { "x-admin-key": adminKey } }),
  adminApprove: (adminKey, id) =>
    request(`/api/admin/applicants/${id}/approve`, { method: "POST", headers: { "x-admin-key": adminKey } }),
  adminDeny: (adminKey, id) =>
    request(`/api/admin/applicants/${id}/deny`, { method: "POST", headers: { "x-admin-key": adminKey } }),
  adminCreatePoll: (adminKey, question, options, description, documents, votingMethod, required) =>
    request("/api/admin/polls", {
      method: "POST",
      headers: {
        "x-admin-key": adminKey,
        "Idempotency-Key": `poll-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({ question, options, description, documents, votingMethod, required }),
    }),
  adminClosePoll: (adminKey, id) =>
    request(`/api/admin/polls/${id}/close`, { method: "POST", headers: { "x-admin-key": adminKey } }),
  adminDocuments: (adminKey) =>
    request("/api/admin/documents", { headers: { "x-admin-key": adminKey } }),

  adminSendInvitations: (adminKey, emails) =>
    request("/api/admin/invitations", {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: JSON.stringify({ emails }),
    }),
  adminInvitations: (adminKey) =>
    request("/api/admin/invitations", { headers: { "x-admin-key": adminKey } }),
  confirmInvitation: (token, name) =>
    request("/api/invitations/confirm", { method: "POST", body: JSON.stringify({ token, name }) }),

  // Only works when the backend has DEV_LOGIN_ENABLED=true — see routes/dev-login.js
  devLogin: (email, password) =>
    request("/api/dev/login", { method: "POST", body: JSON.stringify({ email, password }) }),
};
