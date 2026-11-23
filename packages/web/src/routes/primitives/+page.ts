import { error } from "@sveltejs/kit";

export const ssr = false;
export const load = () => {
  if (import.meta.env.VITE_CONVEYOR_PRIMITIVES !== "1") error(404, "Not found");
};
