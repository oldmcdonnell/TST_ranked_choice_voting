<template>
  <nav>
    <router-link to="/">Home</router-link>
    <router-link to="/checkin">Check-In Map</router-link>
    <router-link to="/polls">Polls</router-link>
    <router-link to="/login">Member Login</router-link>
    <router-link to="/admin">Admin</router-link>
  </nav>
</template>

<script>
export default {
  name: "Navigation",
};
</script>

<style scoped>
nav {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}
nav a {
  color: #333;
  text-decoration: none;
  font-weight: 600;
}
nav a.router-link-exact-active {
  color: #6b1f1f;
}
</style>
