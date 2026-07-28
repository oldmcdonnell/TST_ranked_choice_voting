<template>
  <div class="shell">
    <nav>
      <router-link to="/">Home</router-link>
      <router-link to="/checkin">Check-In Map</router-link>
      <router-link to="/polls">Polls</router-link>
      <router-link to="/login">Member Login</router-link>
      <router-link to="/admin">Admin</router-link>
    </nav>
    <main>
      <router-view />
    </main>
  </div>
</template>

<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f7f5f2; }
  .shell { max-width: 760px; margin: 0 auto; padding: 1.5rem; }
  nav { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
  nav a { color: #333; text-decoration: none; font-weight: 600; }
  nav a.router-link-exact-active { color: #6b1f1f; }
  button { cursor: pointer; padding: .5rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: white; }
  input { padding: .4rem; border-radius: 4px; border: 1px solid #ccc; }
  .card { background: white; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
</style>
