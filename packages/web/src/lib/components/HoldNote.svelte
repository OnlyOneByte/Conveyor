<script lang="ts">
  import { HELD } from "#lib/job-failure.js";
  import Notice from "./Notice.svelte";
</script>

<div class="held" role="note">
  <Notice tone="warn" title={HELD.title}><span slot="message">{HELD.detail}</span></Notice>
</div>

<style>
  .held { margin-bottom: var(--s5); }
  .held:last-child { margin-bottom: 0; }
</style>
