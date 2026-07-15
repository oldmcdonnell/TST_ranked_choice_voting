<template>
  <div class="card">
    <h2>Member login</h2>
    <p>Enter your email — we'll send a one-time login link. No password needed.</p>
    <form @submit.prevent="submit">
      <input v-model="email" type="email" placeholder="Email" required />
      <button style="margin-left:.5rem" type="submit">Send login link</button>
    </form>
    <p v-if="sent">
      If that email belongs to an approved member, a login link was sent.
      (In dev, check the backend server console/log for the mock email.)
    </p>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";

const email = ref("");
const sent = ref(false);

async function submit() {
  await api.requestLoginLink(email.value);
  sent.value = true;
}
</script>
