import { toasts } from "./ui/behaviour";

export const DIALOG_DOWN = "The printer form didn't load. Reload the page to try again.";

export const loadPrinterDialog = () =>
  import("./components/PrinterDialog.svelte").then(
    (m) => m.default,
    () => {
      toasts.show(DIALOG_DOWN);
      return null;
    },
  );
