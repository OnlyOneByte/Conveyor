import { error } from "@sveltejs/kit";

const enabled = import.meta.env.VITE_CONVEYOR_PRIMITIVES === "1";
export const ssr = !enabled;
export const load = () => {
  if (!enabled) error(404, "Not found");
};
