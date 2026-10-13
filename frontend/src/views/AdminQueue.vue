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
      <button style="margin-top:.5rem" @click="createPoll">Create poll</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";

const adminKey = ref("");
onMounted(() => {
  const devKey = localStorage.getItem("devAdminKey");
  if (devKey) adminKey.value = devKey;
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
    const res = await api.adminSendInvitations(adminKey.value, emails);
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
  errorMessage.value = "";
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
    await api.adminCreatePoll(
      adminKey.value,
      question.value.trim(),
      cleanOptions,
      description.value.trim(),
      selectedDocuments.value,
      votingMethod.value,
      required.value
    );
    question.value = "";
    description.value = "";
    options.value = ["", ""];
    selectedDocuments.value = [];
    votingMethod.value = "single";
    required.value = false;
    alert("Poll created.");
  } catch (err) {
    friendlyError(err);
  }
}
</script>
