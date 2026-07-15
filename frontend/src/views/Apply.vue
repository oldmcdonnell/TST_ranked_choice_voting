<template>
  <div class="card">
    <h2>Apply for membership</h2>
    <p>An admin will review your application before an account is created. This page's URL should stay unlisted.</p>
    <form @submit.prevent="submit">
      <div><input v-model="name" placeholder="Full name" required /></div>
      <div style="margin-top:.5rem"><input v-model="email" type="email" placeholder="Email" required /></div>
      <button style="margin-top:.75rem" type="submit">Submit application</button>
    </form>
    <p v-if="sent">Thanks — your application was submitted.</p>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";

const name = ref("");
const email = ref("");
const sent = ref(false);

async function submit() {
  await api.apply(name.value, email.value);
  sent.value = true;
}
</script>
