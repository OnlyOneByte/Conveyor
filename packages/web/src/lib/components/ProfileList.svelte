<script lang="ts">
  import { slicerFormat } from "@conveyor/shared/profile";
  import type { CatalogProfile, CatalogSlicer } from "#lib/api.js";
  import { profileFacts, profileTag } from "#lib/profile-facts.js";
  import DeleteProfile from "./DeleteProfile.svelte";
  import ProfileDialog from "./ProfileDialog.svelte";

  export let profiles: CatalogProfile[];
  export let slicers: CatalogSlicer[];
  export let flavors: string[];
  export let changed: () => void;

  let [adding, deleting] = [false, false];
  let doomed: CatalogProfile | null = null;

  const plus = "M12 5v14M5 12h14";
  const editPath = (id: string) =>
    `/settings/profiles/${id.split("/").map(encodeURIComponent).join("/")}`;

  function remove(profile: CatalogProfile) {
    doomed = profile;
    deleting = true;
  }
</script>

<section class="panel" aria-labelledby="profiles-h">
  <header>
    <div>
      <h2 id="profiles-h">Profiles</h2>
      <p class="sub">How the slicer turns a model into G-code for your printer.</p>
    </div>
    <button class="btn big" type="button" on:click={() => (adding = true)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={plus} /></svg>Add profile
    </button>
  </header>
  {#if profiles.length}
    <ul class="list">
      {#each profiles as profile (profile.id)}
        <li>
          <div class="n">
            <b>{profile.name}</b>
            <span class="facts">{profileFacts(profile, slicers)}</span>
          </div>
          <span class="tag" class:edited={profile.hasEditableContent}>{profileTag(profile)}</span>
          <div class="acts">
            {#if slicerFormat(profile.slicerId)}
              <a class="btn big" href={editPath(profile.id)} aria-label="Edit {profile.name}">
                Edit
              </a>
            {/if}
            {#if !profile.bundled}
              <button
                class="btn big danger"
                type="button"
                aria-label="Delete {profile.name}"
                on:click={() => remove(profile)}
              >
                Delete
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="sub">No profiles yet. Add one so Make can slice.</p>
  {/if}
  <p class="note">
    Bundled profiles ship with Conveyor. You can change their settings and reset them, but not
    delete them.
  </p>
</section>

<ProfileDialog bind:open={adding} {slicers} {flavors} taken={profiles.map((p) => p.id)} {changed} />
<DeleteProfile bind:open={deleting} profile={doomed} {changed} />

<style>
  .panel {
    display: flex; flex-direction: column; gap: var(--s4); padding: var(--s5);
    border-radius: var(--r-card); background: var(--paper); border: 1px solid var(--line);
    box-shadow: var(--lift);
  }
  header { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--s3); }
  header div { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; }
  h2, p { margin: 0; }
  .sub, .note { color: var(--muted); }
  .note { font-size: var(--fs-chip); }
  .list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
  li {
    display: flex; align-items: center; gap: var(--s3); padding: var(--s3) 0;
    border-top: 1px solid var(--line);
  }
  li:first-child { border-top: 0; }
  .n { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .facts { font: 500 13px var(--mono); color: var(--muted); }
  .tag {
    display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px;
    border: 1.5px solid var(--field-line); border-radius: 99px; color: var(--muted);
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .tag.edited { border-color: var(--live); color: var(--live); }
  .acts { display: flex; gap: var(--s2); }
  .big {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    border-color: var(--field-line); text-decoration: none;
  }
  .big.danger { border-color: var(--err); }
  .big svg {
    width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2;
    stroke-linecap: round;
  }
  @media (max-width: 759px) {
    .panel { padding: var(--s4); }
    li { flex-wrap: wrap; }
    .n { flex-basis: calc(100% - 9rem); }
    .acts { margin-left: auto; }
  }
</style>
