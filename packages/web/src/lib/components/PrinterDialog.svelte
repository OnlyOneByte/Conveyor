<script lang="ts">
  import { tick } from "svelte";
  import {
    type CatalogPrinter,
    type CatalogTransport,
    type GeneratorSummary,
    savePrinter,
  } from "#lib/api.js";
  import { deletePrinter } from "#lib/api-delete.js";
  import { fieldOf } from "#lib/http-error.js";
  import * as drafts from "#lib/printer-form.js";
  import { secretFieldFor } from "#lib/printer-secrets.js";
  import { detailOf, said } from "#lib/said.js";
  import { toasts, uid } from "#lib/ui/behaviour.js";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Field from "#lib/ui/Field.svelte";
  import Select from "#lib/ui/Select.svelte";
  import ErrorDetails from "./ErrorDetails.svelte";
  import GeneratorLimits from "./GeneratorLimits.svelte";
  import SavedSecrets from "./SavedSecrets.svelte";

  export let open = false;
  export let printer: CatalogPrinter | null = null;
  export let transports: CatalogTransport[] = [];
  export let generators: GeneratorSummary[] = [];
  export let taken: string[] = [];
  export let jobs = 0;
  export let changed: () => void = () => {};

  let draft = drafts.blankDraft();
  let errors: drafts.DraftErrors = {};
  let [problem, why, failedField]: drafts.Failure = ["", null, null];
  let [busy, idEdited, confirming] = [false, false, false];
  let [tried, secretsSaved, cleared] = [false, false, false];
  let form: HTMLFormElement;
  const formId = uid("printer-form");

  $: adding = printer === null;
  $: if (open) reset(printer);
  $: autoId(draft.name);
  $: if (tried) errors = drafts.draftErrors(draft, taken, adding);
  $: secret = secretFieldFor(draft.transportId);
  $: options = transports.map((t) => ({ value: t.id, label: t.name }));
  $: title = drafts.dialogTitle(printer, confirming);
  const focus = (el: HTMLElement) => el.focus();
  let shown: CatalogPrinter | null | undefined;
  $: if (!open) shown = undefined;

  function reset(next: CatalogPrinter | null) {
    if (shown === next) return;
    shown = next;
    draft = next ? drafts.draftOf(next) : drafts.blankDraft(transports[0]?.id ?? "");
    [errors, problem] = [{}, ""];
    [tried, idEdited, confirming, cleared] = [false, false, false, false];
    secretsSaved = next?.hasSecrets ?? false;
  }

  function autoId(name: string) {
    if (adding && !idEdited) draft.id = drafts.slugOf(name);
  }

  const close = () => (open = false);

  async function attempt(work: () => Promise<void>, explain = said) {
    [problem, busy] = ["", true];
    [problem, why, failedField] = await work().then(
      (): drafts.Failure => ["", null, null],
      (e: unknown): drafts.Failure => [explain(e), detailOf(e), fieldOf(e)],
    );
    busy = false;
  }

  async function save() {
    tried = true;
    errors = drafts.draftErrors(draft, taken, adding);
    if (Object.keys(errors).length) {
      await tick();
      form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    await attempt(async () => {
      await savePrinter(drafts.printerPayload(draft));
      toasts.show(`${adding ? "Added" : "Saved"} ${draft.name.trim()}`);
      close();
      changed();
    });
    if (problem) await tick().then(() => drafts.focusProblem(form, failedField));
  }

  const clearSecrets = (saved: CatalogPrinter) =>
    attempt(async () => {
      await savePrinter(drafts.clearSecretsPayload(saved));
      [secretsSaved, cleared] = [false, true];
      changed();
    });

  const remove = (saved: CatalogPrinter) =>
    attempt(
      async () => {
        await deletePrinter(saved.id);
        toasts.show(`Deleted ${saved.name}`);
        close();
        changed();
      },
      (e) => drafts.deleteFailure(saved.name, said(e)),
    );
</script>

<Dialog {title} bind:open>
  {#if confirming}
    <p>{drafts.deleteNote(jobs)}</p>
    {#if problem}<p class="problem" role="alert">{problem}</p><ErrorDetails detail={why} />{/if}
  {:else}
    <form bind:this={form} id={formId} class="form" novalidate on:submit|preventDefault={save}>
      <Field label="Name" name="name" bind:value={draft.name} error={errors.name ?? ""} />
      {#if adding}
        <Field label="ID" name="id" bind:value={draft.id} on:input={() => (idEdited = true)} hint="Used in this printer's links. It can't change later." error={errors.id ?? ""} />
      {/if}
      <Select label="Printer software" name="transport" bind:value={draft.transportId} {options} hint="Klipper printers run Moonraker. Elegoo printers use ElegooLink." error={errors.transportId ?? ""} />
      <Field label="Address" name="address" bind:value={draft.address} hint={drafts.addressHint(secretsSaved, secret.label)} error={errors.address ?? ""} />
      <Field label={secret.label} name="secrets" type={secret.hidden ? "password" : "text"} bind:value={draft.secret} hint={secretsSaved ? "Leave blank to keep the saved one." : secret.hint} />
      {#key shown}
        {#if printer}
          {@const saved = printer}
          <SavedSecrets label={secretFieldFor(saved.transportId).label} saved={secretsSaved} {cleared} {busy} clear={() => clearSecrets(saved)} />
        {/if}
      {/key}
      <GeneratorLimits {generators} bind:restrict={draft.restrict} bind:allowed={draft.allowed} />
      {#if problem}<p class="problem" role="alert" tabindex="-1">{problem}</p><ErrorDetails detail={why} />{/if}
    </form>
  {/if}
  <svelte:fragment slot="actions">
    {#if confirming}
      <button class="btn ghost" type="button" use:focus on:click={() => ((confirming = false), (problem = ""))}>Keep it</button>
      <button class="btn danger" type="button" disabled={busy || jobs > 0} on:click={() => printer && remove(printer)}>Delete printer</button>
    {:else}
      {#if !adding}<button class="btn danger del" type="button" on:click={() => ((confirming = true), (problem = ""))}>Delete printer</button>{/if}
      <button class="btn ghost" type="button" on:click={close}>Cancel</button>
      <button class="btn primary" type="submit" form={formId} disabled={busy}>{adding ? "Add printer" : "Save changes"}</button>
    {/if}
  </svelte:fragment>
</Dialog>

<style>
  .form { display: flex; flex-direction: column; gap: var(--s4); }
  p { margin: 0; }
  .problem { color: var(--err); font-weight: 600; }
  .del { margin-right: auto; }
</style>
