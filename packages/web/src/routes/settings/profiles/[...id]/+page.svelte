<script lang="ts">
  import ProfileEditor from "#lib/components/ProfileEditor.svelte";
  import { profileFacts, profileTag } from "#lib/profile-facts.js";
  import { invalidateAll } from "$app/navigation";
  import type { PageData } from "./$types";

  export let data: PageData;

  $: ({ profile, content, slicers, failed, problem } = data);
  $: title =
    profile?.name ??
    (failed ? "Can't reach Conveyor" : problem ? "The profile didn't load" : "No such profile");
</script>

<svelte:head><title>{title} · Conveyor</title></svelte:head>

<a class="back" href="/settings">← Settings</a>
<div class="head">
  <h1>{title}</h1>
  {#if profile}<p class="sub">{profileFacts(profile, slicers)} · {profileTag(profile)}</p>{/if}
</div>

{#if failed}
  <div class="empty" role="alert">
    <p class="sub">The profile didn't load. Check that Conveyor is running, then try again.</p>
    <div>
      <button class="btn big" type="button" on:click={() => invalidateAll()}>Try again</button>
    </div>
  </div>
{:else if problem}
  <div class="empty" role="alert">
    <p class="sub answer">Conveyor answered: {problem}</p>
    <div>
      <button class="btn big" type="button" on:click={() => invalidateAll()}>Try again</button>
    </div>
  </div>
{:else if !profile}
  <p class="sub">It may have been deleted. <a href="/settings">Back to Settings</a></p>
{:else if !content}
  <p class="sub">
    Settings for this slicer can't be edited here. Change the files in its folder instead.
  </p>
{:else}
  {#if content.missing}
    <p class="sub">
      This profile has no files yet. Paste the settings your slicer exported, then Save.
    </p>
  {/if}
  {#key profile.id}<ProfileEditor {profile} {content} />{/key}
{/if}

<style>
  .back {
    display: inline-flex; align-items: center; min-height: var(--tap); color: var(--muted);
    font-weight: 600; text-decoration: none;
  }
  @media (hover: hover) { .back:hover { color: var(--ink); } }
  .head { display: flex; flex-direction: column; gap: var(--s1); margin: 0 0 var(--s4); }
  h1, p { margin: 0; line-height: 1.1; }
  .sub { color: var(--muted); line-height: 1.45; }
  .answer { overflow-wrap: anywhere; }
  .empty { display: flex; flex-direction: column; gap: var(--s3); }
  .big { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
</style>
