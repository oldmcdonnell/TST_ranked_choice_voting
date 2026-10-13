<template>
  <!-- Shown when the poll list couldn't load (e.g. not logged in / session
       expired) — otherwise that failure would look like "no open polls". -->
  <p v-if="loadError" style="color:#a33">{{ loadError }}</p>

  <!-- One card per open poll. `polls` is filled by onMounted() at the bottom
       of the script, which calls GET /api/polls (backend/src/routes/polls.js). -->
  <div class="card" v-for="poll in polls" :key="poll.id">
    <!-- Poll header: question, optional description, required flag -->
    <h3>{{ poll.question }}</h3>
    <p v-if="poll.description" style="white-space:pre-wrap;color:#444">{{ poll.description }}</p>
    <p v-if="poll.required" style="font-size:.85em;color:#a33">This vote is required.</p>
    <!-- Links to any reference files the admin attached to this poll.
         URLs come from documentUrl() → GET /api/documents/:name
         (backend/src/routes/documents.js, requires login). -->
    <div v-if="poll.documents && poll.documents.length" style="margin:.5rem 0">
      <strong>Reference documents:</strong>
      <ul style="margin:.25rem 0">
        <li v-for="doc in poll.documents" :key="doc">
          <a :href="documentUrl(doc)" target="_blank" rel="noopener">{{ doc }}</a>
        </li>
      </ul>
    </div>

    <!-- Voting/editing form: shown whenever the edit window is still open,
         whether or not they've voted yet. `editable` is set by
         loadBallotState() on page load and by submitVote() after voting. -->
    <div v-if="editable[poll.id] !== false">
      <p v-if="hasVoted[poll.id]" style="color:#666;font-size:.9em">
        You already voted — you can still change your answer until
        {{ formatTime(editableUntil[poll.id]) }}.
      </p>

      <!-- Ranked-choice ballot: the ordered list is the member's current
           ranking (with up/down/remove controls); the "+ option" buttons
           below it are the options not yet ranked. The buttons call
           moveRank() / removeFromRanking() / addToRanking() in the script,
           which move options between rankedChosen and rankedAvailable. -->
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

      <!-- Single-choice ballot: plain radio buttons, bound to singleChoice -->
      <template v-else>
        <label v-for="opt in poll.options" :key="opt" style="display:block;margin:.25rem 0">
          <input type="radio" :name="poll.id" :value="opt" v-model="singleChoice[poll.id]" /> {{ opt }}
        </label>
      </template>

      <!-- Optional free-text comment stored alongside the anonymous vote -->
      <textarea
        v-model="comment[poll.id]"
        rows="2"
        style="width:100%;margin-top:.5rem"
        maxlength="500"
        placeholder="Optional comment with your vote — don't include anything that identifies you"
      ></textarea>

      <!-- Submit (first time) or Update (re-vote within the edit window).
           Calls submitVote() — see the script for the token flow. -->
      <button style="margin-top:.5rem" @click="submitVote(poll)">
        {{ hasVoted[poll.id] ? "Update vote" : "Submit vote" }}
      </button>
      <p v-if="errors[poll.id]" style="color:#a33;margin-top:.5rem">{{ errors[poll.id] }}</p>

      <!-- After voting: the receipt hash proves the vote is in the tally,
           and can be emailed to the member for safekeeping. The hash comes
           back from submitVote(); the button calls emailReceipt(). -->
      <div v-if="hasVoted[poll.id]" style="margin-top:.5rem">
        Receipt hash: <code>{{ receiptHashes[poll.id] }}</code>
        <br />
        <button style="margin-top:.5rem" @click="emailReceipt(poll)" :disabled="emailSent[poll.id]">
          {{ emailSent[poll.id] ? "Receipt emailed ✓" : "Email me this receipt" }}
        </button>
      </div>
    </div>

    <!-- Locked/final state: voted, and the edit window has closed.
         formatChoice() renders the saved answer restored by loadBallotState(). -->
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
  <p v-if="!loadError && polls.length === 0">No open polls right now.</p>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { api, BASE } from "../api.js";

// List of open polls from the server, and any error loading it
const polls = ref([]);
const loadError = ref("");

// ---- Small display helpers ----

// Download URL for a poll's attached reference document
function documentUrl(filename) {
  return `${BASE}/api/documents/${encodeURIComponent(filename)}`;
}
// Turn an ISO timestamp into the user's local date/time
function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "";
}
// Human-readable version of the member's final answer (locked state)
function formatChoice(poll) {
  if (poll.votingMethod === "ranked") {
    const chosen = rankedChosen[poll.id] || [];
    return chosen.length ? chosen.join(" → ") : "(no ranking submitted)";
  }
  return singleChoice[poll.id] || "(no choice submitted)";
}
// localStorage key under which this browser keeps the anonymous ballot
// token for a poll (needed to view/change the vote later)
function tokenKey(pollId) {
  return `ballotToken:${pollId}`;
}

// ---- Per-poll UI state, each keyed by poll id ----
const ballotToken = reactive({});     // anonymous token used to cast/edit the vote
const singleChoice = reactive({});    // selected option (single-choice polls)
const rankedChosen = reactive({});    // ordered ranking so far (ranked polls)
const rankedAvailable = reactive({}); // options not yet ranked (ranked polls)
const comment = reactive({});         // optional comment text
const hasVoted = reactive({});        // has a vote been recorded with our token?
const editable = reactive({});        // is the edit window still open?
const editableUntil = reactive({});   // when the edit window closes (ISO time)
const receiptHashes = reactive({});   // receipt hash returned after voting
const errors = reactive({});          // error message to show on the card
const emailSent = reactive({});       // receipt email already sent?


// ---- Ranked-choice controls ----

// Move an option from "available" to the end of the ranking
function addToRanking(pollId, opt) {
  rankedChosen[pollId].push(opt);
  rankedAvailable[pollId] = rankedAvailable[pollId].filter(o => o !== opt);
}
// Take an option out of the ranking and make it available again
function removeFromRanking(pollId, opt) {
  rankedChosen[pollId] = rankedChosen[pollId].filter(o => o !== opt);
  rankedAvailable[pollId].push(opt);
}
// Swap a ranked option with its neighbour (delta -1 = up, +1 = down)
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
  // Start from a blank ballot
  if (poll.votingMethod === "ranked") {
    rankedChosen[poll.id] = [];
    rankedAvailable[poll.id] = [...poll.options];
  } else {
    singleChoice[poll.id] = null;
  }
  hasVoted[poll.id] = false;
  editable[poll.id] = true;
  comment[poll.id] = "";

  // No saved token → this browser hasn't voted on this poll; keep blank ballot
  const token = localStorage.getItem(tokenKey(poll.id));
  if (!token) return;

  // Ask the server what was voted with this token and refill the form
  // (api.myBallot → GET /api/polls/:id/my-ballot in backend/src/routes/polls.js)

  try {
    const mb = await api.myBallot(poll.id, token);
    ballotToken[poll.id] = token;
    hasVoted[poll.id] = mb.hasVoted;
    editable[poll.id] = mb.editable;
    editableUntil[poll.id] = mb.editableUntil;
    comment[poll.id] = mb.comment || "";
    receiptHashes[poll.id] = mb.receiptHash || "";
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

// Validate the ballot, get an anonymous ballot token if we don't have one
// yet, then cast (or re-cast) the vote with it.
async function submitVote(poll) {
  errors[poll.id] = "";
  const choice = poll.votingMethod === "ranked" ? rankedChosen[poll.id] : singleChoice[poll.id];
  const isEmpty = poll.votingMethod === "ranked" ? !choice || choice.length === 0 : !choice;
  if (isEmpty) {
    errors[poll.id] = poll.votingMethod === "ranked" ? "Rank at least one option." : "Pick an option first.";
    return;
  }

  try {
    // First vote: exchange the login session for an anonymous token (this is
    // the only step that ties the member to the poll), and remember it in
    // localStorage so they can edit the vote later from this browser.
    // (api.requestBallot → POST /api/polls/:id/request-ballot; returns 409
    // "already voted in this poll" if this member already took a token.)
    let token = ballotToken[poll.id];
    if (!token) {
      const res = await api.requestBallot(poll.id);
      token = res.ballotToken;
      ballotToken[poll.id] = token;
      localStorage.setItem(tokenKey(poll.id), token);
    }
    // Cast the vote using only the anonymous token
    // (api.vote → POST /api/polls/:id/vote; no login cookie needed here)
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

// Ask the server to email the receipt hash to the logged-in member
// (api.emailReceipt → POST /api/polls/:id/email-receipt, requires login)
async function emailReceipt(poll) {
  try {
    await api.emailReceipt(poll.id, receiptHashes[poll.id]);
    emailSent[poll.id] = true;
  } catch (err) {
    errors[poll.id] = err.message || "Couldn't email the receipt — you still have it saved above.";
  }
}

// On page load: fetch open polls, then restore each poll's ballot state.
// A failure here (most often 401 "login required") is shown to the user
// instead of being silently treated as an empty poll list. The login cookie
// is set by the login flow (or dev login on Home.vue → routes/dev-login.js).
onMounted(async () => {
  try {
    polls.value = await api.polls();
  } catch (err) {
    polls.value = [];
    loadError.value = err.message === "login required"
      ? "You're not logged in (or your session expired) — log in again to see polls."
      : `Couldn't load polls: ${err.message}`;
    return;
  }
  await Promise.all(polls.value.map(loadBallotState));
});
</script>
