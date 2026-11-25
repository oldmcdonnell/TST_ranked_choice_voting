<template>
  <div class="card">
    <h2>Admin</h2>
    <p style="color:#a33">
      Stub auth only — this key input is a placeholder for the real FIDO2/YubiKey
      login that should gate this whole page before go-live.
    </p>
    <input v-model="adminKey" placeholder="admin key" />
    <button @click="loadApplicants">Load pending applicants</button>
    <p v-if="errorMessage" style="color:#a33;margin-top:.5rem">{{ errorMessage }}</p>
  </div>

  <div class="card" v-for="a in applicants" :key="a.id">
    <strong>{{ a.name }}</strong> — {{ a.email }}
    <div style="margin-top:.5rem">
      <button @click="approve(a.id)">Approve</button>
      <button style="margin-left:.5rem" @click="deny(a.id)">Deny</button>
    </div>
  </div>

  <div class="card">
    <h3>Invite congregation to vote</h3>
    <p>Paste emails (one per line, or comma-separated). Each person confirms their own email before they can vote.</p>
    <label style="display:block;margin-bottom:.5rem">
      Invite for vote:
      <select v-model="invitePollId" style="margin-left:.5rem">
        <option value="">— general membership (link valid 30 days) —</option>
        <option v-for="p in invitablePolls" :key="p.id" :value="p.id">
          {{ p.question }} (closes {{ formatTime(p.closesAt) }})
        </option>
      </select>
    </label>
    <p v-if="invitePollId" style="font-size:.85em;color:#666;margin:.25rem 0 .5rem">
      Invite links will stop working when this poll closes, and the email names the poll and its voting window.
    </p>
    <textarea v-model="invitesRaw" rows="5" style="width:100%" placeholder="jane@example.com&#10;john@example.com"></textarea>
    <button style="margin-top:.5rem" @click="sendInvitations">Send invitations</button>
    <div v-if="inviteResults.length" style="margin-top:.75rem">
      <div v-for="r in inviteResults" :key="r.email">{{ r.email }} — {{ r.status }}</div>
    </div>

    <button style="margin-top:1rem" @click="loadInvitations">Refresh invitation list</button>
    <table v-if="invitations.length" style="margin-top:.5rem; width:100%">
      <tr v-for="inv in invitations" :key="inv.id">
        <td>{{ inv.email }}</td>
        <td>{{ inv.status }}</td>
        <td>{{ inv.invited_at }}</td>
      </tr>
    </table>
  </div>

  <div class="card">
    <h3>Polls</h3>
    <button @click="loadPolls">Refresh poll list</button>
    <p v-if="!adminPolls.length" style="font-size:.9em;color:#666">No polls loaded yet.</p>
    <div v-for="p in adminPolls" :key="p.id" style="border-top:1px solid #eee;margin-top:.75rem;padding-top:.75rem">
      <div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
        <strong>{{ p.question }}</strong>
        <span :style="{ color: phaseColor(p.phase), fontWeight: 600, textTransform: 'uppercase', fontSize: '.8em' }">{{ p.phase }}</span>
      </div>
      <div style="font-size:.85em;color:#666">
        {{ p.votingMethod === "ranked" ? "Ranked choice" : "Single choice" }}{{ p.required ? " · required" : "" }}
        · {{ p.participants }} {{ p.participants === 1 ? "member has" : "members have" }} voted
        <br />Opens {{ formatTime(p.opensAt) || "immediately" }} · closes {{ formatTime(p.closesAt) || "when closed manually" }}
        <br />Poll ID: <code>{{ p.id }}</code>
      </div>
      <div style="margin-top:.5rem">
        <button @click="toggleResults(p)">{{ pollResults[p.id] ? "Hide results" : "View results" }}</button>
        <button v-if="p.phase !== 'closed'" style="margin-left:.5rem" @click="closePoll(p)">Close poll now</button>
      </div>
      <PollResults v-if="pollResults[p.id]" :results="pollResults[p.id]" style="margin-top:.5rem" />
    </div>
  </div>

  <div class="card">
    <h3>Open a new poll</h3>
    <input v-model="question" placeholder="Question" style="width:100%" />
    <textarea
      v-model="description"
      rows="3"
      style="width:100%;margin-top:.5rem"
      placeholder="Optional blurb: give voters context on what's being decided"
    ></textarea>

    <div style="margin-top:.5rem">
      <label style="margin-right:1rem">
        <input type="radio" value="single" v-model="votingMethod" /> Single choice (use this for Yes/No too)
      </label>
      <label>
        <input type="radio" value="ranked" v-model="votingMethod" /> Ranked choice
      </label>
    </div>
    <label style="display:block;margin-top:.5rem">
      <input type="checkbox" v-model="required" /> Required (counts toward the missed-vote rule)
    </label>

    <div style="margin-top:.5rem;display:flex;gap:1rem;flex-wrap:wrap">
      <label>
        Voting opens
        <input type="datetime-local" v-model="opensAt" style="display:block" />
        <span style="font-size:.8em;color:#666">Leave blank to open immediately</span>
      </label>
      <label>
        Voting closes (required)
        <input type="datetime-local" v-model="closesAt" style="display:block" />
        <span style="font-size:.8em;color:#666">The poll closes itself at this time</span>
      </label>
    </div>

    <div v-for="(opt, i) in options" :key="i" style="margin-top:.5rem;display:flex;gap:.5rem">
      <input v-model="options[i]" :placeholder="`Option ${i + 1}`" style="flex:1" />
      <button @click="removeOption(i)" :disabled="options.length <= 2" title="Remove option">✕</button>
    </div>
    <button style="margin-top:.5rem" @click="addOption">Add option</button>

    <div style="margin-top:.75rem">
      <strong>Reference documents</strong>
      <p style="margin:.25rem 0;font-size:.9em;color:#666">
        Stubbed: drop files into <code>backend/data/documents/</code>, then refresh the list
        and check the ones voters should see for this poll.
      </p>
      <button @click="loadDocuments">Refresh document list</button>
      <div v-if="availableDocuments.length" style="margin-top:.5rem">
        <label v-for="doc in availableDocuments" :key="doc" style="display:block">
          <input type="checkbox" :value="doc" v-model="selectedDocuments" /> {{ doc }}
        </label>
      </div>
      <p v-else style="font-size:.9em;color:#666">No documents in the folder yet.</p>
    </div>

    <div>
      <!-- Disabled while a create request is in flight, so a double-click
           can't fire a second request (the idempotency key below is the
           backstop if one gets through anyway). -->
      <button style="margin-top:.5rem" @click="createPoll" :disabled="creatingPoll">
        {{ creatingPoll ? "Creating…" : "Create poll" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { api } from "../api.js";
import PollResults from "../components/PollResults.vue";

const adminKey = ref("");
onMounted(() => {
  const devKey = localStorage.getItem("devAdminKey");
  if (devKey) {
    adminKey.value = devKey;
    loadPolls();
  }
});
const applicants = ref([]);
const question = ref("");
const description = ref("");
const votingMethod = ref("single");
const required = ref(false);
const options = ref(["", ""]); // start with 2 blank options — minimum needed for a poll
const availableDocuments = ref([]);
const selectedDocuments = ref([]);
const invitesRaw = ref("");
const inviteResults = ref([]);
const invitations = ref([]);
const errorMessage = ref("");
const opensAt = ref("");   // datetime-local string, in the admin's own timezone
const closesAt = ref("");
const adminPolls = ref([]);
const pollResults = reactive({}); // poll id → results object, when expanded
const invitePollId = ref("");
const invitablePolls = computed(() => adminPolls.value.filter(p => p.phase !== "closed" && p.closesAt));

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "";
}
function phaseColor(phase) {
  return phase === "open" ? "#2a7a2a" : phase === "upcoming" ? "#a66b00" : "#666";
}
// datetime-local gives "YYYY-MM-DDTHH:MM" with no zone; new Date() reads it
// as the admin's local time, and toISOString() sends it to the backend as UTC.
function toIso(local) {
  return local ? new Date(local).toISOString() : undefined;
}

async function loadPolls() {
  errorMessage.value = "";
  try {
    adminPolls.value = await api.adminPolls(adminKey.value);
  } catch (err) {
    friendlyError(err);
  }
}
async function toggleResults(p) {
  if (pollResults[p.id]) {
    delete pollResults[p.id];
    return;
  }
  errorMessage.value = "";
  try {
    pollResults[p.id] = await api.adminPollResults(adminKey.value, p.id);
  } catch (err) {
    friendlyError(err);
  }
}
async function closePoll(p) {
  if (!confirm(`Close "${p.question}" now? Members won't be able to vote or change their votes after this.`)) return;
  errorMessage.value = "";
  try {
    pollResults[p.id] = await api.adminClosePoll(adminKey.value, p.id);
    await loadPolls();
  } catch (err) {
    friendlyError(err);
  }
}

// One Idempotency-Key per poll draft: reused for every click/retry until the
// poll is actually created, then replaced so the next poll gets a fresh one.
// The backend (lib/idempotency.js) returns the first result for a repeated
// key instead of creating a duplicate poll.
function newPollKey() {
  return `poll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const pollIdempotencyKey = ref(newPollKey());
const creatingPoll = ref(false);

function addOption() {
  options.value.push("");
}
function removeOption(i) {
  if (options.value.length <= 2) return; // a poll needs at least 2 options
  options.value.splice(i, 1);
}

function friendlyError(err) {
  // Same message the backend sends for a missing/wrong key — surface it
  // plainly rather than letting it fall through as an unhandled rejection.
  errorMessage.value = err.message === "admin auth required (stub)"
    ? "Admin key missing or incorrect — check the field above."
    : (err.message || "Something went wrong.");
}

async function loadApplicants() {
  errorMessage.value = "";
  try {
    applicants.value = await api.adminApplicants(adminKey.value);
  } catch (err) {
    friendlyError(err);
  }
}
async function approve(id) {
  errorMessage.value = "";
  try {
    await api.adminApprove(adminKey.value, id);
    await loadApplicants();
  } catch (err) {
    friendlyError(err);
  }
}
async function deny(id) {
  errorMessage.value = "";
  try {
    await api.adminDeny(adminKey.value, id);
    await loadApplicants();
  } catch (err) {
    friendlyError(err);
  }
}
async function sendInvitations() {
  errorMessage.value = "";
  const emails = invitesRaw.value
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!emails.length) return;
  try {
    const res = await api.adminSendInvitations(adminKey.value, emails, invitePollId.value);
    inviteResults.value = res.results;
    invitesRaw.value = "";
    await loadInvitations();
  } catch (err) {
    friendlyError(err);
  }
}
async function loadInvitations() {
  errorMessage.value = "";
  try {
    invitations.value = await api.adminInvitations(adminKey.value);
  } catch (err) {
    friendlyError(err);
  }
}
async function loadDocuments() {
  errorMessage.value = "";
  try {
    availableDocuments.value = await api.adminDocuments(adminKey.value);
  } catch (err) {
    friendlyError(err);
  }
}
async function createPoll() {
  if (creatingPoll.value) return; // a request is already in flight
  errorMessage.value = "";
  creatingPoll.value = true;
  try {
    const cleanOptions = options.value.map(o => o.trim()).filter(Boolean);
    if (!question.value.trim()) {
      errorMessage.value = "Enter a question first.";
      return;
    }
    if (cleanOptions.length < 2) {
      errorMessage.value = "Enter at least 2 non-empty options.";
      return;
    }
    if (!closesAt.value) {
      errorMessage.value = "Set when voting closes.";
      return;
    }
    await api.adminCreatePoll(
      adminKey.value,
      pollIdempotencyKey.value,
      question.value.trim(),
      cleanOptions,
      description.value.trim(),
      selectedDocuments.value,
      votingMethod.value,
      required.value,
      toIso(opensAt.value),
      toIso(closesAt.value)
    );
    question.value = "";
    description.value = "";
    options.value = ["", ""];
    selectedDocuments.value = [];
    votingMethod.value = "single";
    required.value = false;
    opensAt.value = "";
    closesAt.value = "";
    await loadPolls();
    // Poll exists now — the next draft needs its own key
    pollIdempotencyKey.value = newPollKey();
    alert("Poll created.");
  } catch (err) {
    // Keep the same key: retrying this draft after a failure (e.g. the
    // response was lost but the poll was created) must not duplicate it.
    friendlyError(err);
  } finally {
    creatingPoll.value = false;
  }
}
</script>
