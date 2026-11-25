import { API } from "./api";
import { failure } from "./http-error.js";

async function del(path: string): Promise<void> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) throw await failure(r, `DELETE ${path}`);
}

export const deletePrinter = (id: string) =>
  del(`${API}/catalog/printers/${encodeURIComponent(id)}`);
export const deleteProfile = (id: string) =>
  del(`${API}/catalog/profiles/${encodeURIComponent(id)}`);

export const resetProfileContent = (id: string) =>
  del(`${API}/catalog/profiles/${encodeURIComponent(id)}/content`);
