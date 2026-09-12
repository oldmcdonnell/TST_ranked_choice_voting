<template>
  <div class="card" v-for="poll in polls" :key="poll.id">
    <h3>{{ poll.question }}</h3>
    <p v-if="poll.description" style="white-space:pre-wrap;color:#444">{{ poll.description }}</p>
    <div v-if="poll.documents && poll.documents.length" style="margin:.5rem 0">
      <strong>Reference documents:</strong>
      <ul style="margin:.25rem 0">
        <li v-for="doc in poll.documents" :key="doc">
          <a :href="documentUrl(doc)" target="_blank" rel="noopener">{{ doc }}</a>
        </li>
      </ul>
    </div>
    <div v-if="!results[poll.id]">
      <label v-for="opt in poll.options" :key="opt" style="display:block;margin:.25rem 0">
        <input type="radio" :name="poll.id" :value="opt" v-model="choice[poll.id]" /> {{ opt }}
      </label>
      <button @click="castVote(poll.id)">Submit vote</button>
      <p v-if="errors[poll.id]" style="color:#a33;margin-top:.5rem">{{ errors[poll.id] }}</p>
    </div>
    <p v-else>
      Vote recorded — receipt hash: <code>{{ results[poll.id] }}</code>
      <br />This proves your vote was tallied, without revealing which option you picked.
      <br />Save this hash somewhere — once the poll closes, you can check it against the
      published results to confirm your vote was counted correctly.
      <br />
      <button style="margin-top:.5rem" @click="emailReceipt(poll.id)" :disabled="emailSent[poll.id]">
        {{ emailSent[poll.id] ? "Receipt emailed ✓" : "Email me this receipt" }}
      </button>
    </p>
  </div>
  <p v-if="polls.length === 0">No open polls right now.</p>
</template>

<script setup>
import { ref, onMounted, reactive } from "vue";
import { api, BASE } from "../api.js";

const polls = ref([]);

function documentUrl(filename) {
  return `${BASE}/api/documents/${encodeURIComponent(filename)}`;
}
const choice = reactive({});
const results = reactive({});
const errors = reactive({});
const emailSent = reactive({});

async function castVote(pollId) {
  errors[pollId] = "";
  if (!choice[pollId]) {
    errors[pollId] = "Pick an option first.";
    return;
  }
  try {
    // Step 1: request an anonymous ballot token (this is where "has voted" gets recorded)
    const { ballotToken } = await api.requestBallot(pollId);
    // Step 2: submit the vote using only the token — no identity attached
    const { receiptHash } = await api.vote(pollId, ballotToken, choice[pollId]);
    results[pollId] = receiptHash;
  } catch (err) {
    errors[pollId] = err.message === "already voted in this poll"
      ? "You've already voted in this poll."
      : (err.message || "Something went wrong submitting your vote.");
  }
}

async function emailReceipt(pollId) {
  try {
    await api.emailReceipt(pollId, results[pollId]);
    emailSent[pollId] = true;
  } catch (err) {
    errors[pollId] = err.message || "Couldn't email the receipt — you still have it saved above.";
  }
}

onMounted(async () => {
  polls.value = await api.polls().catch(() => []);
});
</script>
