<script lang="ts">
  import { tick } from "svelte";
  import { type CatalogSlicer, saveProfile } from "#lib/api.js";
  import {
    firmwareName,
    folderOf,
    type ProfileDraft,
    type ProfileErrors,
    profileErrors,
    profilePayload,
  } from "#lib/profile-facts.js";
  import { detailOf, said } from "#lib/said.js";
  import { toasts, uid } from "#lib/ui/behaviour.js";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Field from "#lib/ui/Field.svelte";
  import Select from "#lib/ui/Select.svelte";
  import ErrorDetails from "./ErrorDetails.svelte";

  export let open = false;
  export let slicers: CatalogSlicer[] = [];
  export let flavors: string[] = [];
  export let taken: string[] = [];
  export let changed: () => void = () => {};

  let draft: ProfileDraft = blank();
  let errors: ProfileErrors = {};
  let [busy, tried, folderEdited, started] = [false, false, false, false];
  let [problem, why]: [string, string | null] = ["", null];
  let form: HTMLFormElement;
  const formId = uid("profile-form");

  function blank(): ProfileDraft {
    return { name: "", slicerId: slicers[0]?.id ?? "", gcodeFlavor: flavors[0] ?? "", path: "" };
  }

  $: if (open) start();
  $: if (!open) started = false;
  $: autoFolder(draft.name);
  $: if (tried) errors = profileErrors(draft, taken);
  $: slicerOptions = slicers.map((s) => ({ value: s.id, label: s.name }));
  $: firmwareOptions = flavors.map((f) => ({ value: f, label: firmwareName(f) }));

  function start() {
    if (started) return;
    started = true;
    [draft, errors, problem, tried, folderEdited] = [blank(), {}, "", false, false];
  }

  function autoFolder(name: string) {
    if (!folderEdited) draft.path = name.trim() ? folderOf(name) : "";
  }

  async function add() {
    tried = true;
    errors = profileErrors(draft, taken);
    if (Object.keys(errors).length) {
      await tick();
      form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    [busy, problem] = [true, ""];
    try {
      await saveProfile(profilePayload(draft));
      toasts.show(`Added ${draft.name.trim()}`);
      open = false;
      changed();
    } catch (e) {
      [problem, why] = [said(e), detailOf(e)];
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Add profile" bind:open>
  <form bind:this={form} id={formId} class="form" novalidate on:submit|preventDefault={add}>
    <Field
      label="Name"
      bind:value={draft.name}
      hint="Say the material and layer height, like Voron PETG 0.2 mm."
      error={errors.name ?? ""}
    />
    <Select label="Slicer" bind:value={draft.slicerId} options={slicerOptions} />
    <Select
      label="Printer firmware"
      bind:value={draft.gcodeFlavor}
      options={firmwareOptions}
      hint="The kind of G-code the printer expects."
    />
    <Field
      label="Folder"
      bind:value={draft.path}
      on:input={() => (folderEdited = true)}
      hint="The folder under /profiles that holds this profile's files."
      error={errors.path ?? ""}
    />
    {#if problem}<p class="problem" role="alert">{problem}</p><ErrorDetails detail={why} />{/if}
  </form>
  <svelte:fragment slot="actions">
    <button class="btn ghost" type="button" on:click={() => (open = false)}>Cancel</button>
    <button class="btn primary" type="submit" form={formId} disabled={busy}>Add profile</button>
  </svelte:fragment>
</Dialog>

<style>
  .form { display: flex; flex-direction: column; gap: var(--s4); }
  .problem { margin: 0; color: var(--err); font-weight: 600; overflow-wrap: anywhere; }
</style>
