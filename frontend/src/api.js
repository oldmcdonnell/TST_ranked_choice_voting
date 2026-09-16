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

  adminRegisterOptions: (email, name, setupToken) => request("/api/admin/auth/register/options", { method: "POST", body: JSON.stringify({ email, name, setupToken }) }),
  adminRegisterVerify: (challengeId, credential, label) => request("/api/admin/auth/register/verify", { method: "POST", body: JSON.stringify({ challengeId, credential, label }) }),
  adminLoginOptions: (email) => request("/api/admin/auth/login/options", { method: "POST", body: JSON.stringify({ email }) }),
  adminLoginVerify: (challengeId, credential) => request("/api/admin/auth/login/verify", { method: "POST", body: JSON.stringify({ challengeId, credential }) }),
  adminLogout: () => request("/api/admin/auth/logout", { method: "POST" }),
  adminApplicants: () => request("/api/admin/applicants"),
  adminApprove: (id) =>
    request(`/api/admin/applicants/${id}/approve`, { method: "POST" }),
  adminDeny: (id) =>
    request(`/api/admin/applicants/${id}/deny`, { method: "POST" }),
  adminCreatePoll: (question, options, description, documents, votingMethod, required) =>
    request("/api/admin/polls", {
      method: "POST",
      headers: {
        "Idempotency-Key": `poll-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({ question, options, description, documents, votingMethod, required }),
    }),
  adminClosePoll: (id) => request(`/api/admin/polls/${id}/close`, { method: "POST" }),
  adminDocuments: () => request("/api/admin/documents"),

  adminSendInvitations: (emails) =>
    request("/api/admin/invitations", {
      method: "POST",
      body: JSON.stringify({ emails }),
    }),
  adminInvitations: () => request("/api/admin/invitations"),
  confirmInvitation: (token, name) =>
    request("/api/invitations/confirm", { method: "POST", body: JSON.stringify({ token, name }) }),

  // Only works when the backend has DEV_LOGIN_ENABLED=true — see routes/dev-login.js
  devLogin: (email, password) =>
    request("/api/dev/login", { method: "POST", body: JSON.stringify({ email, password }) }),
};
