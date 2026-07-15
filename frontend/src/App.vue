<template>
  <div class="shell">
    <Navigation />
    <main>
      <router-view />
    </main>
  </div>
</template>

<script>
import Navigation from "./components/Navigation.vue";

export default {
  components: { Navigation },
};
</script>

<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f7f5f2; }
  .shell { max-width: 760px; margin: 0 auto; padding: 1.5rem; }
  button { cursor: pointer; padding: .5rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: white; }
  input { padding: .4rem; border-radius: 4px; border: 1px solid #ccc; }
  .card { background: white; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
</style>
