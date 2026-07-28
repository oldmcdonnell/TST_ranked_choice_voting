<template>
  <div class="card">
    <h2>Admin</h2>
    <p style="color:#a33">
      Stub auth only — this key input is a placeholder for the real FIDO2/YubiKey
      login that should gate this whole page before go-live.
    </p>
    <input v-model="adminKey" placeholder="admin key" />
    <button @click="loadApplicants">Load pending applicants</button>
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
    <div style="margin-top:.5rem">
      <input v-model="optionsRaw" placeholder="Options, comma separated" style="width:100%" />
    </div>
    <button style="margin-top:.5rem" @click="createPoll">Create poll</button>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";

const adminKey = ref("");
const applicants = ref([]);
const question = ref("");
const optionsRaw = ref("");
const invitesRaw = ref("");
const inviteResults = ref([]);
const invitations = ref([]);

async function loadApplicants() {
  applicants.value = await api.adminApplicants(adminKey.value);
}
async function approve(id) {
  await api.adminApprove(adminKey.value, id);
  await loadApplicants();
}
async function deny(id) {
  await api.adminDeny(adminKey.value, id);
  await loadApplicants();
}
async function sendInvitations() {
  const emails = invitesRaw.value
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!emails.length) return;
  const res = await api.adminSendInvitations(adminKey.value, emails);
  inviteResults.value = res.results;
  invitesRaw.value = "";
  await loadInvitations();
}
async function loadInvitations() {
  invitations.value = await api.adminInvitations(adminKey.value);
}
async function createPoll() {
  const options = optionsRaw.value.split(",").map(s => s.trim()).filter(Boolean);
  await api.adminCreatePoll(adminKey.value, question.value, options);
  question.value = "";
  optionsRaw.value = "";
  alert("Poll created.");
}
</script>
