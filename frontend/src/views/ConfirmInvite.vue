<template>
  <div class="card">
    <h2>Confirm your invitation</h2>
    <p v-if="status === 'form'">You've been invited to join TST Kentucky's voting roll. Enter your name to confirm.</p>
    <form v-if="status === 'form'" @submit.prevent="submit">
      <input v-model="name" placeholder="Full name" required style="width:100%" />
      <button style="margin-top:.75rem" type="submit">Confirm</button>
    </form>
    <p v-else-if="status === 'ok'">You're confirmed and logged in. <router-link to="/polls">Go to polls</router-link></p>
    <p v-else-if="status === 'error'">{{ errorMessage }}</p>
    <p v-else>Loading…</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";

const route = useRoute();
const status = ref("loading");
const name = ref("");
const errorMessage = ref("");

onMounted(() => {
  if (!route.query.token) {
    status.value = "error";
    errorMessage.value = "Missing invitation token.";
    return;
  }
  status.value = "form";
});

async function submit() {
  try {
    await api.confirmInvitation(route.query.token, name.value);
    status.value = "ok";
  } catch (err) {
    status.value = "error";
    errorMessage.value = err.message || "That invitation link is invalid or expired.";
  }
}
</script>
