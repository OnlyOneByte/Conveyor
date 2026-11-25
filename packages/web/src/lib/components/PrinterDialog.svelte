<script lang="ts">
  import { tick } from "svelte";
  import { deletePrinter, savePrinter, type CatalogPrinter, type CatalogTransport, type GeneratorSummary } from "#lib/api.js";
  import { blankDraft, clearSecretsPayload, draftErrors, draftOf, type DraftErrors, printerPayload, slugOf } from "#lib/printer-form.js";
  import { secretFieldFor } from "#lib/printer-secrets.js";
  import { detailOf, said } from "#lib/said.js";
  import ErrorDetails from "./ErrorDetails.svelte";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Field from "#lib/ui/Field.svelte";
  import Select from "#lib/ui/Select.svelte";
  import GeneratorLimits from "./GeneratorLimits.svelte";
  import { toasts, uid } from "#lib/ui/behaviour.js";

  export let open = false;
  export let printer: CatalogPrinter | null = null;
  export let transports: CatalogTransport[] = [];
  export let generators: GeneratorSummary[] = [];
  export let taken: string[] = [];
  export let jobs = 0;
  export let changed: () => void = () => {};

  let draft = blankDraft();
  let errors: DraftErrors = {};
  let [problem, why]: [string, string | null] = ["", null];
  let [busy, idEdited, confirming, tried, secretsSaved, cleared] = [false, false, false, false, false, false];
  let form: HTMLFormElement;
  const formId = uid("printer-form");

  $: adding = printer === null;
  $: if (open) reset(printer);
  $: autoId(draft.name);
  $: if (tried) errors = draftErrors(draft, taken, adding);
  $: secret = secretFieldFor(draft.transportId);
  $: options = transports.map((t) => ({ value: t.id, label: t.name }));
  $: title = confirming ? `Delete ${printer?.name}?` : adding ? "Add printer" : `Edit ${printer?.name}`;
  $: [them, waiting] = jobs === 1 ? ["it", "It has a job on the belt"] : ["them", `It has ${jobs} jobs on the belt`];
  const focus = (el: HTMLElement) => el.focus();
  $: secretHint = secretsSaved ? "Leave blank to keep the saved one." : secret.hint;
  $: if (!open) shown = undefined;

  let shown: CatalogPrinter | null | undefined;
  function reset(next: CatalogPrinter | null) {
    if (shown === next) return;
    shown = next;
    draft = next ? draftOf(next) : blankDraft(transports[0]?.id ?? "");
    [errors, problem] = [{}, ""];
    [tried, idEdited, confirming, cleared] = [false, false, false, false];
    secretsSaved = next?.hasSecrets ?? false;
  }

  function autoId(name: string) {
    if (adding && !idEdited) draft.id = slugOf(name);
  }

  const close = () => (open = false);

  async function attempt(work: () => Promise<void>, explain = said) {
    problem = "";
    busy = true;
    try {
      await work();
    } catch (e) {
      [problem, why] = [explain(e), detailOf(e)];
    } finally {
      busy = false;
    }
  }

  async function save() {
    tried = true;
    errors = draftErrors(draft, taken, adding);
    if (Object.keys(errors).length) {
      await tick();
      form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    await attempt(async () => {
      await savePrinter(printerPayload(draft));
      toasts.show(`${adding ? "Added" : "Saved"} ${draft.name.trim()}`);
      close();
      changed();
    });
  }

  const clearSecrets = (saved: CatalogPrinter) =>
    attempt(async () => {
      await savePrinter(clearSecretsPayload(saved));
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
      (e) => (said(e).includes("queued or running") ? `${saved.name} still has jobs on the belt, so it can't be deleted yet.` : said(e)),
    );
</script>

<Dialog {title} bind:open>
  {#if confirming}
    <p>
      {jobs ? `${waiting}. Cancel ${them} or let ${them} finish, then delete it.` : "Jobs it already printed keep their history."}
    </p>
    {#if problem}<p class="problem" role="alert">{problem}</p><ErrorDetails detail={why} />{/if}
  {:else}
    <form bind:this={form} id={formId} class="form" novalidate on:submit|preventDefault={save}>
      <Field label="Name" bind:value={draft.name} error={errors.name ?? ""} />
      {#if adding}
        <Field label="ID" bind:value={draft.id} on:input={() => (idEdited = true)} hint="Used in this printer's links. It can't change later." error={errors.id ?? ""} />
      {/if}
      <Select label="Printer software" bind:value={draft.transportId} {options} hint="Klipper printers run Moonraker. Elegoo printers use ElegooLink." error={errors.transportId ?? ""} />
      <Field label="Address" bind:value={draft.address} hint="The IP address on the printer's screen, like 192.168.1.50. Add :port only if you changed it." error={errors.address ?? ""} />
      <Field label={secret.label} type={secret.hidden ? "password" : "text"} bind:value={draft.secret} hint={secretHint} />
      {#if secretsSaved}
        <div class="saved">
          <span>A key is saved for this printer. It stays until you clear it.</span>
          <button class="btn" type="button" disabled={busy} on:click={() => printer && clearSecrets(printer)}>Clear saved secrets</button>
        </div>
      {:else if cleared}
        <p class="saved" role="status">Saved secrets cleared.</p>
      {/if}
      <GeneratorLimits {generators} bind:restrict={draft.restrict} bind:allowed={draft.allowed} />
      {#if problem}<p class="problem" role="alert">{problem}</p><ErrorDetails detail={why} />{/if}
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
  .saved { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s3); padding: var(--s3); border-radius: var(--r-control); background: var(--sunk); color: var(--muted); }
  .saved span { flex: 1; min-width: 12rem; }
  .problem { color: var(--err); font-weight: 600; }
  .del { margin-right: auto; }
</style>
