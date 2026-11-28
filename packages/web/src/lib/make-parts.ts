export type MakeParts = typeof import("./components/make-parts");

export const MAKE_DOWN =
  "Make's form didn't load. Check your connection and try again, or reload the page.";

export const loadMakeParts = (): Promise<MakeParts | null> =>
  import("./components/make-parts").catch(() => null);
