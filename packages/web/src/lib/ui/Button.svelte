<script lang="ts">
  export let variant: "primary" | "secondary" | "ghost" | "danger" = "secondary";
  export let type: "button" | "submit" = "button";
  export let disabled = false;
</script>

<button class="btn {variant}" {type} {disabled} on:click><slot /></button>
