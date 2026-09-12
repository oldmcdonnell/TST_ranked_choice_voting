<template>
  <div class="card" v-for="poll in polls" :key="poll.id">
    <h3>{{ poll.question }}</h3>
    <p v-if="poll.description" style="white-space:pre-wrap;color:#444">{{ poll.description }}</p>
    <p v-if="poll.required" style="font-size:.85em;color:#a33">This vote is required.</p>
    <div v-if="poll.documents && poll.documents.length" style="margin:.5rem 0">
      <strong>Reference documents:</strong>
      <ul style="margin:.25rem 0">
        <li v-for="doc in poll.documents" :key="doc">
          <a :href="documentUrl(doc)" target="_blank" rel="noopener">{{ doc }}</a>
        </li>
      </ul>
    </div>

    <!-- Voting/editing form: shown whenever the edit window is still open,
         whether or not they've voted yet. -->
    <div v-if="editable[poll.id] !== false">
      <p v-if="hasVoted[poll.id]" style="color:#666;font-size:.9em">
        You already voted — you can still change your answer until
        {{ formatTime(editableUntil[poll.id]) }}.
      </p>

      <template v-if="poll.votingMethod === 'ranked'">
        <p style="font-size:.9em;color:#444">
          Click options in your preferred order. You don't have to rank all of them.
        </p>
        <ol style="padding-left:1.25rem" v-if="rankedChosen[poll.id] && rankedChosen[poll.id].length">
          <li v-for="(opt, i) in rankedChosen[poll.id]" :key="opt" style="margin:.25rem 0">
            {{ opt }}
            <button @click="moveRank(poll.id, i, -1)" :disabled="i === 0" title="Move up">↑</button>
            <button @click="moveRank(poll.id, i, 1)" :disabled="i === rankedChosen[poll.id].length - 1" title="Move down">↓</button>
            <button @click="removeFromRanking(poll.id, opt)" title="Remove from ranking">✕</button>
          </li>
        </ol>
        <div v-if="rankedAvailable[poll.id] && rankedAvailable[poll.id].length" style="margin-top:.5rem">
          <button
            v-for="opt in rankedAvailable[poll.id]"
            :key="opt"
            @click="addToRanking(poll.id, opt)"
            style="margin:0 .25rem .25rem 0"
          >
            + {{ opt }}
          </button>
        </div>
      </template>

      <template v-else>
        <label v-for="opt in poll.options" :key="opt" style="display:block;margin:.25rem 0">
          <input type="radio" :name="poll.id" :value="opt" v-model="singleChoice[poll.id]" /> {{ opt }}
        </label>
      </template>

      <textarea
        v-model="comment[poll.id]"
        rows="2"
        style="width:100%;margin-top:.5rem"
        maxlength="500"
        placeholder="Optional comment with your vote — don't include anything that identifies you"
      ></textarea>

      <button style="margin-top:.5rem" @click="submitVote(poll)">
        {{ hasVoted[poll.id] ? "Update vote" : "Submit vote" }}
      </button>
      <p v-if="errors[poll.id]" style="color:#a33;margin-top:.5rem">{{ errors[poll.id] }}</p>

      <div v-if="hasVoted[poll.id]" style="margin-top:.5rem">
        Receipt hash: <code>{{ receiptHashes[poll.id] }}</code>
        <br />
        <button style="margin-top:.5rem" @click="emailReceipt(poll)" :disabled="emailSent[poll.id]">
          {{ emailSent[poll.id] ? "Receipt emailed ✓" : "Email me this receipt" }}
        </button>
      </div>
    </div>

    <!-- Locked/final state: voted, and the edit window has closed. -->
    <div v-else>
      <p>
        Your final answer: <strong>{{ formatChoice(poll) }}</strong>
        <br />This proves your vote was tallied, without revealing which option you picked to anyone else.
        <br />Receipt hash: <code>{{ receiptHashes[poll.id] }}</code>
        <br />The edit window has closed — this is locked in.
      </p>
      <button @click="emailReceipt(poll)" :disabled="emailSent[poll.id]">
        {{ emailSent[poll.id] ? "Receipt emailed ✓" : "Email me this receipt" }}
      </button>
    </div>
  </div>
  <p v-if="polls.length === 0">No open polls right now.</p>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { api, BASE } from "../api.js";

const polls = ref([]);

function documentUrl(filename) {
  return `${BASE}/api/documents/${encodeURIComponent(filename)}`;
}
function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "";
}
function formatChoice(poll) {
  if (poll.votingMethod === "ranked") {
    const chosen = rankedChosen[poll.id] || [];
    return chosen.length ? chosen.join(" → ") : "(no ranking submitted)";
  }
  return singleChoice[poll.id] || "(no choice submitted)";
}
function tokenKey(pollId) {
  return `ballotToken:${pollId}`;
}

const ballotToken = reactive({});
const singleChoice = reactive({});
const rankedChosen = reactive({});
const rankedAvailable = reactive({});
const comment = reactive({});
const hasVoted = reactive({});
const editable = reactive({});
const editableUntil = reactive({});
const receiptHashes = reactive({});
const errors = reactive({});
const emailSent = reactive({});

function addToRanking(pollId, opt) {
  rankedChosen[pollId].push(opt);
  rankedAvailable[pollId] = rankedAvailable[pollId].filter(o => o !== opt);
}
function removeFromRanking(pollId, opt) {
  rankedChosen[pollId] = rankedChosen[pollId].filter(o => o !== opt);
  rankedAvailable[pollId].push(opt);
}
function moveRank(pollId, index, delta) {
  const list = rankedChosen[pollId];
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

// Restore in-progress/completed ballots from the token saved in this
// browser for each poll, so a reload during the edit window doesn't lose
// the member's place. A missing/rejected token just means "not voted yet
// from this browser" — never a member's identity, since the token itself
// is anonymous.
async function loadBallotState(poll) {
  if (poll.votingMethod === "ranked") {
    rankedChosen[poll.id] = [];
    rankedAvailable[poll.id] = [...poll.options];
  } else {
    singleChoice[poll.id] = null;
  }
  hasVoted[poll.id] = false;
  editable[poll.id] = true;
  comment[poll.id] = "";

  const token = localStorage.getItem(tokenKey(poll.id));
  if (!token) return;

  try {
    const mb = await api.myBallot(poll.id, token);
    ballotToken[poll.id] = token;
    hasVoted[poll.id] = mb.hasVoted;
    editable[poll.id] = mb.editable;
    editableUntil[poll.id] = mb.editableUntil;
    comment[poll.id] = mb.comment || "";
    if (poll.votingMethod === "ranked") {
      rankedChosen[poll.id] = mb.choice || [];
      rankedAvailable[poll.id] = poll.options.filter(o => !rankedChosen[poll.id].includes(o));
    } else {
      singleChoice[poll.id] = mb.choice || null;
    }
  } catch {
    // Stale/invalid token for this poll — treat as not voted from this browser.
    localStorage.removeItem(tokenKey(poll.id));
  }
}

async function submitVote(poll) {
  errors[poll.id] = "";
  const choice = poll.votingMethod === "ranked" ? rankedChosen[poll.id] : singleChoice[poll.id];
  const isEmpty = poll.votingMethod === "ranked" ? !choice || choice.length === 0 : !choice;
  if (isEmpty) {
    errors[poll.id] = poll.votingMethod === "ranked" ? "Rank at least one option." : "Pick an option first.";
    return;
  }

  try {
    let token = ballotToken[poll.id];
    if (!token) {
      const res = await api.requestBallot(poll.id);
      token = res.ballotToken;
      ballotToken[poll.id] = token;
      localStorage.setItem(tokenKey(poll.id), token);
    }
    const { receiptHash, editableUntil: until } = await api.vote(poll.id, token, choice, comment[poll.id] || undefined);
    receiptHashes[poll.id] = receiptHash;
    hasVoted[poll.id] = true;
    editable[poll.id] = true;
    editableUntil[poll.id] = until;
  } catch (err) {
    errors[poll.id] = err.message === "already voted in this poll"
      ? "You already voted on this from another browser or device — this browser doesn't have the ballot token needed to view or change it."
      : (err.message || "Something went wrong submitting your vote.");
  }
}

async function emailReceipt(poll) {
  try {
    await api.emailReceipt(poll.id, receiptHashes[poll.id]);
    emailSent[poll.id] = true;
  } catch (err) {
    errors[poll.id] = err.message || "Couldn't email the receipt — you still have it saved above.";
  }
}

onMounted(async () => {
  polls.value = await api.polls().catch(() => []);
  await Promise.all(polls.value.map(loadBallotState));
});
</script>
