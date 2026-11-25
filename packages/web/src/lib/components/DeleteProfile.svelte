<script lang="ts">
  import { type CatalogProfile, deleteProfile, saveProfile } from "#lib/api.js";
  import { type Content, loadContent, saveContent } from "#lib/profile-content.js";
  import { couldnt, detailOf, said } from "#lib/said.js";
  import ErrorDetails from "./ErrorDetails.svelte";
  import { toasts } from "#lib/ui/behaviour.js";
  import Confirm from "./Confirm.svelte";

  export let open = false;
  export let profile: CatalogProfile | null = null;
  export let changed: () => void;
  export let deleted: (id: string) => void = () => {};

  let busy = false;
  let [problem, why]: [string, string | null] = ["", null];
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  $: if (open) problem = "";

  function explain(name: string, e: unknown) {
    return message(e).includes("queued or running")
      ? `${name} has jobs on the belt. Let them finish, then delete it.`
      : said(e);
  }

  async function remove() {
    if (!profile) return;
    const target = profile;
    [busy, problem] = [true, ""];
    try {
      const content = target.hasEditableContent ? await loadContent(target) : null;
      await deleteProfile(target.id);
      open = false;
      deleted(target.id);
      changed();
      const undo = { label: "Undo", run: () => void restore(target, content) };
      toasts.show(`Deleted ${target.name}`, undo);
    } catch (e) {
      [problem, why] = [explain(target.name, e), detailOf(e)];
    } finally {
      busy = false;
    }
  }

  async function restore(target: CatalogProfile, content: Content | null) {
    const { id, slicerId, name, path, gcodeFlavor } = target;
    try {
      await saveProfile({ id, slicerId, name, path, gcodeFlavor });
      if (content?.edited) await saveContent(target, content.lang, content.docs);
      toasts.show(`Restored ${name}`);
    } catch (e) {
      toasts.show(couldnt(`restore ${name}`, e));
    }
    changed();
  }
</script>

<Confirm
  bind:open
  title="Delete {profile?.name}?"
  keep="Keep it"
  go="Delete profile"
  {busy}
  run={remove}
>
  <p>Make stops offering it. Jobs already printed with it keep their history.</p>
  {#if problem}<p class="problem" role="alert">{problem}</p><ErrorDetails detail={why} />{/if}
</Confirm>

<style>
  p { margin: 0; }
  .problem { margin-top: var(--s3); color: var(--err); font-weight: 600; overflow-wrap: anywhere; }
</style>
