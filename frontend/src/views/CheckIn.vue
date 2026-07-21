<template>
  <div class="card">
    <h2>Check-in map</h2>
    <p>Opt-in only — turn visibility off any time.</p>
    <label><input type="checkbox" v-model="visible" /> Show my location to other members</label>
    <div>
      <button style="margin-top:.5rem" @click="useMyLocation">Use my current location</button>
      <button style="margin-top:.5rem;margin-left:.5rem" @click="save">Save</button>
    </div>
    <p v-if="saved">Saved.</p>
    <p v-if="notRecognized" style="color:#a33">
      You'll need to be recognized by an admin (in person, e.g. at a service) before you can share your location.
    </p>
  </div>
  <div class="card">
    <div id="map" style="height:350px;border-radius:8px"></div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import L from "leaflet";
import { api } from "../api.js";

const visible = ref(false);
const saved = ref(false);
const notRecognized = ref(false);
let lat = null, lng = null;
let map, markersLayer;

function useMyLocation() {
  navigator.geolocation.getCurrentPosition((pos) => {
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    map.setView([lat, lng], 11);
  });
}

async function save() {
  notRecognized.value = false;
  saved.value = false;
  try {
    await api.checkin(lat, lng, visible.value);
    saved.value = true;
  } catch (err) {
    if (err.message?.includes("not yet recognized")) {
      notRecognized.value = true;
    } else {
      throw err;
    }
  }
  await loadCheckins();
}

async function loadCheckins() {
  const rows = await api.checkins().catch(() => []);
  markersLayer.clearLayers();
  rows.forEach(r => {
    if (r.lat && r.lng) L.marker([r.lat, r.lng]).addTo(markersLayer).bindPopup(r.name);
  });
}

onMounted(async () => {
  map = L.map("map").setView([38.0, -84.5], 7); // rough Kentucky center
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  await loadCheckins();
});
</script>
