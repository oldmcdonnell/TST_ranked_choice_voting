<template>
  <div class="card">
    <h1>TST Kentucky</h1>
    <p>Stubbed platform — check-ins, member-only accounts, and anonymous one-person-one-vote polls.</p>
    <p>
      Not a member yet? <router-link to="/apply">Apply here</router-link>.
    </p>
  </div>

  <div class="card" v-if="isDev">
    <h3>Dev login (local only)</h3>
    <p style="font-size:.85em;color:#666">
      Only visible in `npm run dev`. Requires <code>DEV_LOGIN_ENABLED=true</code> in
      <code>backend/.env</code> — logs in as the dev admin or dev member without the
      real invite-email or admin-key flow.
    </p>
    <input v-model="email" placeholder="email" style="width:100%" />
    <input v-model="password" type="password" placeholder="password" style="width:100%;margin-top:.5rem" />
    <button style="margin-top:.5rem" @click="devLogin">Dev login</button>
    <p v-if="message" style="margin-top:.5rem">{{ message }}</p>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";

const isDev = import.meta.env.DEV;
const email = ref("");
const password = ref("");
const message = ref("");
const router = useRouter();

async function devLogin() {
  message.value = "";
  try {
    const res = await api.devLogin(email.value.trim(), password.value);
    if (res.role === "admin") {
      localStorage.setItem("devAdminKey", res.adminKey);
      message.value = "Logged in as dev admin — opening Admin page.";
      router.push("/admin");
    } else {
      message.value = "Logged in as dev member — opening Polls page.";
      router.push("/polls");
    }
  } catch (err) {
    message.value = err.message || "Dev login failed.";
  }
}
</script>
