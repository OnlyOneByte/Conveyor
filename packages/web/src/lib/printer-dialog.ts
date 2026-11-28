import { toasts } from "./ui/behaviour";

export const DIALOG_DOWN =
  "The printer form didn't load. Check your connection and try again, or reload the page.";

export const loadPrinterDialog = () =>
  import("./components/PrinterDialog.svelte").then(
    (m) => m.default,
    () => {
      toasts.show(DIALOG_DOWN);
      return null;
    },
  );
