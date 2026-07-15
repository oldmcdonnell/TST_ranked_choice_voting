<template>
  <div class="card">
    <h2>Logging you in…</h2>
    <p v-if="status === 'ok'">You're logged in. <router-link to="/polls">Go to polls</router-link></p>
    <p v-else-if="status === 'error'">That link is invalid or expired — request a new one from the login page.</p>
    <p v-else>Verifying…</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";

const route = useRoute();
const status = ref("loading");

onMounted(async () => {
  try {
    await api.verifyLogin(route.query.token);
    status.value = "ok";
  } catch {
    status.value = "error";
  }
});
</script>
