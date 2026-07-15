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
async function createPoll() {
  const options = optionsRaw.value.split(",").map(s => s.trim()).filter(Boolean);
  await api.adminCreatePoll(adminKey.value, question.value, options);
  question.value = "";
  optionsRaw.value = "";
  alert("Poll created.");
}
</script>
