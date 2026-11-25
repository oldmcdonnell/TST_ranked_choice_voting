<template>
  <!-- Renders the output of computeResults() in backend/src/routes/polls.js,
       for both single-choice and ranked (instant-runoff) polls. Used by the
       admin page and the public Verify page. -->
  <div>
    <p style="margin:.25rem 0">
      <strong>{{ results.totalVotes }}</strong> {{ results.totalVotes === 1 ? "ballot" : "ballots" }} counted ·
      Chain integrity:
      <span :style="{ color: results.chain.valid ? '#2a7a2a' : '#a33', fontWeight: 600 }">
        {{ results.chain.valid ? "intact ✓" : "BROKEN — contact an admin" }}
      </span>
    </p>

    <!-- Single choice: one bar per option -->
    <template v-if="results.method === 'single'">
      <p v-if="results.totalVotes === 0" style="color:#666">No votes yet.</p>
      <div v-for="[opt, n] in singleRows" :key="opt" style="margin:.35rem 0">
        <div style="display:flex;justify-content:space-between;font-size:.95em">
          <span>{{ opt }}</span>
          <span>{{ n }} ({{ pct(n, results.totalVotes) }})</span>
        </div>
        <div style="background:#eee;border-radius:4px;height:8px">
          <div :style="{ width: pct(n, results.totalVotes), background: '#6b1f1f', height: '8px', borderRadius: '4px' }"></div>
        </div>
      </div>
    </template>

    <!-- Ranked choice: winner + round-by-round instant-runoff table -->
    <template v-else>
      <p style="margin:.5rem 0">
        Winner:
        <strong v-if="results.winner">{{ results.winner }}</strong>
        <span v-else style="color:#666">none (no ballots)</span>
      </p>
      <div v-if="results.rounds && results.rounds.length" style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:.9em;min-width:100%">
          <thead>
            <tr>
              <th style="text-align:left;padding:.25rem .5rem">Option</th>
              <th v-for="(r, i) in results.rounds" :key="i" style="text-align:right;padding:.25rem .5rem">Round {{ i + 1 }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="opt in rankedOptions" :key="opt" style="border-top:1px solid #eee">
              <td style="padding:.25rem .5rem" :style="{ fontWeight: opt === results.winner ? 700 : 400 }">{{ opt }}</td>
              <td v-for="(r, i) in results.rounds" :key="i" style="text-align:right;padding:.25rem .5rem">
                <template v-if="opt in r.counts">
                  <span :style="{ textDecoration: r.eliminated === opt ? 'line-through' : 'none', color: r.eliminated === opt ? '#a33' : 'inherit' }">
                    {{ r.counts[opt] }}
                  </span>
                </template>
                <span v-else style="color:#bbb">—</span>
              </td>
            </tr>
            <tr style="border-top:1px solid #eee;color:#666">
              <td style="padding:.25rem .5rem">Exhausted ballots</td>
              <td v-for="(r, i) in results.rounds" :key="i" style="text-align:right;padding:.25rem .5rem">
                {{ results.totalVotes - r.activeBallots }}
              </td>
            </tr>
          </tbody>
        </table>
        <p style="font-size:.85em;color:#666;margin:.4rem 0">
          Each round, the option with the fewest votes (struck through) is eliminated and its
          ballots move to their next-ranked choice. "Exhausted" ballots ranked no remaining option.
        </p>
        <p v-for="(r, i) in tieRounds" :key="'t' + i" style="font-size:.85em;color:#a33;margin:.25rem 0">
          Round {{ r.round }}: {{ r.tiedForLast.join(", ") }} tied for last — {{ r.eliminated }}
          was eliminated by option order, not by votes. Admins should review.
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({ results: { type: Object, required: true } });

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : "0%";
}

const singleRows = computed(() =>
  Object.entries(props.results.counts || {}).sort((a, b) => b[1] - a[1])
);

// Options in the order they were listed on the poll (falls back to the
// first round's keys for results returned before `options` was included).
const rankedOptions = computed(
  () => props.results.options || Object.keys(props.results.rounds?.[0]?.counts || {})
);

const tieRounds = computed(() =>
  (props.results.rounds || [])
    .map((r, i) => ({ ...r, round: i + 1 }))
    .filter(r => r.tiedForLast)
);
</script>
