<script lang="ts">
  import { tick } from "svelte";
  import { deletePrinter, savePrinter, type CatalogPrinter, type CatalogTransport, type GeneratorSummary } from "#lib/api.js";
  import { blankDraft, clearSecretsPayload, draftErrors, draftOf, type DraftErrors, printerPayload, slugOf } from "#lib/printer-form.js";
  import { secretFieldFor } from "#lib/printer-secrets.js";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Field from "#lib/ui/Field.svelte";
  import Select from "#lib/ui/Select.svelte";
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
  let problem = "";
  let busy = false;
  let idEdited = false;
  let confirming = false;
  let tried = false;
  let secretsSaved = false;
  let cleared = false;
  let form: HTMLFormElement;
  const formId = uid("printer-form");

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  $: adding = printer === null;
  $: if (open) reset(printer);
  $: autoId(draft.name);
  $: if (tried) errors = draftErrors(draft, taken, adding);
  $: secret = secretFieldFor(draft.transportId);
  $: options = transports.map((t) => ({ value: t.id, label: t.name }));
  $: title = confirming ? `Delete ${printer?.name}?` : adding ? "Add printer" : `Edit ${printer?.name}`;
  $: secretHint = secretsSaved ? "Leave blank to keep the saved one." : secret.hint;
  $: if (!open) shown = undefined;

  let shown: CatalogPrinter | null | undefined;
  function reset(next: CatalogPrinter | null) {
    if (shown === next) return;
    shown = next;
    draft = next ? draftOf(next) : blankDraft(transports[0]?.id ?? "");
    errors = {};
    tried = false;
    problem = "";
    idEdited = false;
    confirming = false;
    secretsSaved = next?.hasSecrets ?? false;
    cleared = false;
  }

  function autoId(name: string) {
    if (adding && !idEdited) draft.id = slugOf(name);
  }

  function toggle(id: string, on: boolean) {
    draft.allowed = on ? [...draft.allowed, id] : draft.allowed.filter((g) => g !== id);
  }

  const close = () => (open = false);

  async function save() {
    problem = "";
    tried = true;
    errors = draftErrors(draft, taken, adding);
    if (Object.keys(errors).length) {
      await tick();
      form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    busy = true;
    try {
      await savePrinter(printerPayload(draft));
      toasts.show(adding ? `Added ${draft.name.trim()}` : `Saved ${draft.name.trim()}`);
      close();
      changed();
    } catch (e) {
      problem = message(e);
    } finally {
      busy = false;
    }
  }

  async function clearSecrets() {
    if (!printer) return;
    problem = "";
    busy = true;
    try {
      await savePrinter(clearSecretsPayload(printer));
      secretsSaved = false;
      cleared = true;
      changed();
    } catch (e) {
      problem = message(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!printer) return;
    problem = "";
    busy = true;
    try {
      await deletePrinter(printer.id);
      toasts.show(`Deleted ${printer.name}`);
      close();
      changed();
    } catch (e) {
      const text = message(e);
      problem = text.includes("queued or running") ? `${printer.name} still has jobs waiting or running, so it can't be deleted yet.` : text;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {title} bind:open>
  {#if confirming}
    <p>
      {#if jobs}{jobs === 1 ? "Its waiting job has" : `Its ${jobs} waiting jobs have`} to finish or be canceled first.{/if}
      Jobs it already printed keep their history.
    </p>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  {:else}
    <form bind:this={form} id={formId} class="form" novalidate on:submit|preventDefault={save}>
      <Field label="Name" bind:value={draft.name} error={errors.name ?? ""} />
      {#if adding}
        <Field label="ID" bind:value={draft.id} on:input={() => (idEdited = true)} hint="Used in links and the API. It can't change later." error={errors.id ?? ""} />
      {/if}
      <Select label="Connection" bind:value={draft.transportId} {options} error={errors.transportId ?? ""} />
      <Field label="Address" bind:value={draft.address} hint="IP address or host name. Add :port if it isn't the usual one." error={errors.address ?? ""} />
      <Field label={secret.label} type={secret.hidden ? "password" : "text"} bind:value={draft.secret} hint={secretHint} />
      {#if secretsSaved}
        <div class="saved">
          <span>Secrets are saved for this printer.</span>
          <button class="btn" type="button" disabled={busy} on:click={clearSecrets}>Clear saved secrets</button>
        </div>
      {:else if cleared}
        <p class="saved" role="status">Saved secrets cleared.</p>
      {/if}
      <fieldset>
        <legend class="sr">Generators</legend>
        <label class="check"><input type="checkbox" bind:checked={draft.restrict} />Only some generators can print here</label>
        {#if draft.restrict}
          <div class="gens">
            {#each generators as g (g.id)}
              <label class="check"><input type="checkbox" checked={draft.allowed.includes(g.id)} on:change={(e) => toggle(g.id, e.currentTarget.checked)} />{g.name}</label>
            {/each}
          </div>
          {#if !draft.allowed.length}<p class="hint">Tick at least one, or this printer takes no jobs.</p>{/if}
        {/if}
      </fieldset>
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </form>
  {/if}
  <svelte:fragment slot="actions">
    {#if confirming}
      <button class="btn ghost" type="button" on:click={() => ((confirming = false), (problem = ""))}>Keep it</button>
      <button class="btn danger" type="button" disabled={busy} on:click={remove}>Delete printer</button>
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
  fieldset { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: var(--s1); }
  .check { display: flex; align-items: center; gap: var(--s2); min-height: 30px; }
  .check input { flex: none; margin: 0; }
  .gens { display: flex; flex-direction: column; margin-left: 26px; }
  .hint { font-size: var(--fs-chip); color: var(--muted); }
  .saved { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s3); padding: var(--s3); border-radius: var(--r-control); background: var(--sunk); color: var(--muted); }
  .saved span { flex: 1; min-width: 12rem; }
  .problem { color: var(--err); font-weight: 600; }
  .del { margin-right: auto; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (pointer: coarse) { .check { min-height: var(--tap); } }
</style>
