import { get, writable } from "svelte/store";
import { announce } from "./announce";
import { fetchActiveJobs } from "./api";
import { midnight } from "./belt-ends";
import { type Catalog, loadCatalog } from "./catalog";
import {
  type Counts,
  type Filter,
  fetchCounts,
  fetchPage,
  latest,
  liveRow,
  mergeSettled,
  PAGE,
  type Row,
  settledRow,
} from "./jobs-list";

export interface JobsView {
  filter: Filter;
  live: Row[];
  settled: Row[];
  counts: Counts | null;
  catalog: Catalog | null;
  loaded: boolean;
  down: boolean;
  more: boolean;
  since: number | undefined;
}

const start: JobsView = {
  filter: "all",
  live: [],
  settled: [],
  counts: null,
  catalog: null,
  loaded: false,
  down: false,
  more: false,
  since: undefined,
};

export function createJobsView(day: () => string | null) {
  const view = writable<JobsView>(start);
  const set = (patch: Partial<JobsView>) => view.update((now) => ({ ...now, ...patch }));
  const req = latest();
  const markDown = () => set({ down: true });

  async function refresh(at = req.now()) {
    const { filter, since, counts } = get(view);
    const got = await req.keep(
      at,
      Promise.all([fetchPage(filter, undefined, since), fetchCounts(since).catch(() => counts)]),
    );
    if (!got) return;
    const [first, total] = got.value;
    const { catalog, loaded, settled } = get(view);
    const fresh = first.map((entry) => settledRow(entry, catalog, Date.now()));
    set({
      settled: loaded ? mergeSettled(settled, fresh) : fresh,
      ...(loaded ? {} : { more: first.length === PAGE }),
      counts: total,
    });
  }

  async function poll() {
    const views =
      document.visibilityState === "visible" ? await fetchActiveJobs().catch(() => null) : null;
    if (!views) return;
    const { live, catalog } = get(view);
    const was = new Set(live.map((row) => row.id));
    const next = views.map((v) => liveRow(v, catalog, Date.now()));
    set({ live: next });
    if ([...was].some((id) => !next.some((row) => row.id === id))) await refresh().catch(markDown);
  }

  async function load() {
    const at = req.start();
    set({ since: day() === "today" ? midnight(new Date()) : undefined });
    set({ catalog: await loadCatalog().catch(() => null) });
    const [views, history] = await Promise.allSettled([fetchActiveJobs(), refresh(at)]);
    if (at !== req.now()) return;
    const { catalog } = get(view);
    set({
      down: history.status === "rejected" || views.status === "rejected",
      live:
        views.status === "fulfilled" ? views.value.map((v) => liveRow(v, catalog, Date.now())) : [],
      loaded: true,
    });
  }

  async function choose(filter: Filter) {
    set({ filter, loaded: false, settled: [] });
    await load();
  }

  async function older() {
    const { filter, settled, since } = get(view);
    const got = await req.keep(
      req.now(),
      fetchPage(filter, settled.at(-1), since).catch(() => null),
    );
    const next = got?.value;
    if (!got) return;
    if (!next) return void announce("Couldn't load older jobs. Try again.", "assertive");
    const { catalog } = get(view);
    set({
      settled: mergeSettled(
        get(view).settled,
        next.map((entry) => settledRow(entry, catalog, Date.now())),
      ),
      more: next.length === PAGE,
    });
  }

  return { subscribe: view.subscribe, refresh, poll, load, choose, older, markDown };
}
