<script lang="ts">
  export let title: string;
  export let tone: string;
  export let pill: string;
  export let meta: string;
  export let when: string;
</script>

<a class="crumb" href="/history">← Jobs</a>
<div class="head">
  <div class="t">
    <h1 id="job-title">{title}</h1>
    <p class="meta">
      {#if pill}<span class="pill {tone}">{pill}</span>{/if}
      <span>{meta}</span>
      {#if when}<span>{when}</span>{/if}
    </p>
  </div>
  <div class="acts"><slot /></div>
</div>

<style>
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1.05; letter-spacing: -0.04em; }
  .crumb { font-weight: 600; color: var(--muted); text-decoration: none; }
  .head {
    display: flex; align-items: flex-start; gap: var(--s4); flex-wrap: wrap;
    margin: var(--s2) 0 var(--s5);
  }
  .t { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: var(--s2); }
  .meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3);
    margin: 0; color: var(--muted);
  }
  .pill {
    display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px;
    border: 1.5px solid currentColor; border-radius: 99px; font-weight: 700;
  }
  .pill.done { color: var(--ok); }
  .pill.failed { color: var(--err); }
  .pill.canceled { color: var(--off); }
  .pill.live { color: var(--live); }
  .pill.queued { color: var(--muted); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .acts:empty { display: none; }
  @media (max-width: 759px) {
    .acts { width: 100%; }
    .acts > :global(*) { flex: 1; }
  }
</style>
