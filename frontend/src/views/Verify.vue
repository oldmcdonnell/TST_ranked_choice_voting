<template>
  <div class="card">
    <h2>Verify a receipt</h2>
    <p>Check that a saved receipt hash was actually counted. No login needed —
       having the hash is itself the proof it's yours.</p>
    <input v-model="pollId" placeholder="Poll ID" style="width:100%" />
    <input v-model="hash" placeholder="Receipt hash" style="width:100%;margin-top:.5rem" />
    <button style="margin-top:.5rem" @click="checkReceipt">Check receipt</button>
    <div v-if="receiptResult" style="margin-top:.75rem">
      <p v-if="receiptResult.found">
        ✓ Found — this vote was for <strong>{{ receiptResult.choice }}</strong>,
        cast at {{ receiptResult.castAt }}.
        <br />Chain integrity: {{ receiptResult.chain.valid ? "intact ✓" : "BROKEN — contact an admin" }}
      </p>
      <p v-else>Not found for this poll — double check the poll ID and hash.</p>
    </div>
    <p v-if="receiptError" style="color:#a33;margin-top:.5rem">{{ receiptError }}</p>
  </div>

  <div class="card">
    <h3>Full recount ledger</h3>
    <p>Once a poll is closed, anyone can view every vote's hash and choice
       (never who cast it) to independently recount the results.</p>
    <input v-model="resultsPollId" placeholder="Poll ID" style="width:100%" />
    <button style="margin-top:.5rem" @click="loadResults">Load public results</button>
    <div v-if="publicResults" style="margin-top:.75rem">
      <p><strong>{{ publicResults.question }}</strong> — {{ publicResults.totalVotes }} total votes</p>
      <p>Tally: {{ JSON.stringify(publicResults.counts) }}</p>
      <p>Chain integrity: {{ publicResults.chain.valid ? "intact ✓" : "BROKEN — contact an admin" }}</p>
      <table style="width:100%;margin-top:.5rem">
        <tr><th style="text-align:left">Hash</th><th style="text-align:left">Choice</th><th style="text-align:left">Cast at</th></tr>
        <tr v-for="v in publicResults.ledger" :key="v.hash">
          <td><code style="font-size:.8em">{{ v.hash }}</code></td>
          <td>{{ v.choice }}</td>
          <td>{{ v.castAt }}</td>
        </tr>
      </table>
    </div>
    <p v-if="resultsError" style="color:#a33;margin-top:.5rem">{{ resultsError }}</p>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../api.js";

const pollId = ref("");
const hash = ref("");
const receiptResult = ref(null);
const receiptError = ref("");

const resultsPollId = ref("");
const publicResults = ref(null);
const resultsError = ref("");

async function checkReceipt() {
  receiptError.value = "";
  receiptResult.value = null;
  if (!pollId.value || !hash.value) {
    receiptError.value = "Enter both a poll ID and a receipt hash.";
    return;
  }
  try {
    receiptResult.value = await api.verifyReceipt(pollId.value.trim(), hash.value.trim());
  } catch (err) {
    receiptError.value = err.message || "Couldn't check that receipt.";
  }
}

async function loadResults() {
  resultsError.value = "";
  publicResults.value = null;
  if (!resultsPollId.value) {
    resultsError.value = "Enter a poll ID.";
    return;
  }
  try {
    publicResults.value = await api.publicResults(resultsPollId.value.trim());
  } catch (err) {
    resultsError.value = err.message || "Couldn't load results — the poll may still be open.";
  }
}
</script>
