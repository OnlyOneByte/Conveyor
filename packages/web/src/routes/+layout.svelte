<script lang="ts">
  import "$lib/styles/app.css";
</script>

<div class="shell">
  <header>
    <a href="/" class="brand">
      <span class="logo">▦</span>
      <span>Conveyor</span>
    </a>
    <span class="muted tag">self-hosted · generate → slice → print</span>
  </header>
  <main>
    <slot />
  </main>
</div>

<style>
  .shell { max-width: 72rem; margin: 0 auto; padding: 1rem; }
  header {
    display: flex; align-items: baseline; gap: 1rem;
    padding: 0.5rem 0 1rem; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem;
  }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 1.2rem; color: var(--text); text-decoration: none; }
  .logo { color: var(--accent); }
  .tag { font-size: 0.85rem; }
  @media (max-width: 540px) { .tag { display: none; } }
</style>
