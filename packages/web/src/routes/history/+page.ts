import { redirect } from "@sveltejs/kit";

export const ssr = true;

export const load = () => redirect(308, "/jobs");
