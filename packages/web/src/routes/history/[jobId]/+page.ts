import { redirect } from "@sveltejs/kit";

export const ssr = true;

export const load = ({ params }: { params: { jobId: string } }) =>
  redirect(308, `/jobs/${encodeURIComponent(params.jobId)}`);
