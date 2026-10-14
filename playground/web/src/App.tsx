// The playground: build a config (by form or by hand), point it at a dataset,
// run it locally, keep the result.
//
// The form and the JSON editor are two views of one config. Editing the form
// rewrites the JSON; editing the JSON leaves the form alone, since arbitrary
// JSON has no faithful form representation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Comlink from "comlink";

import { ConfigEditor } from "./components/ConfigEditor";
import { Landing } from "./components/Landing";
import { NavBar } from "./components/NavBar";
import { SotaOverlay } from "./components/SotaOverlay";
import { DatasetList } from "./components/DatasetList";
import { MethodPicker } from "./components/MethodPicker";
import { PipelineBuilder } from "./components/PipelineBuilder";
import { ResultsTable } from "./components/ResultsTable";
import { Guide } from "./components/Guide";
import { RunDetail } from "./components/RunDetail";
import { RunHistory } from "./components/RunHistory";
import { datasetUrl, loadRegistry, loadSampleDataset } from "./lib/dataset";
import {
  benchmarkEntry,
  customEntry,
  sampleEntry,
  type Entry,
  type Progress,
} from "./lib/datasets-panel";
import type { LoadOptions, LoadedFile } from "./lib/h5";
import {
  clearRuns,
  deleteQuantizer,
  deleteRun,
  listRuns,
  listSavedQuantizers,
  saveQuantizer,
  saveRun,
  type RunRecord,
  type SavedQuantizer,
} from "./lib/history";
import { defaultValue, toConfigValue } from "./lib/params";
import { runner } from "./lib/runner";
import { withLoader } from "./lib/loader-pool";
import type { MethodResult, PrimitiveSpec, Quantizer, Stage } from "./lib/types";

const DEFAULT_METRICS = ["recall", "mse_score", "mse_recon"];
const DEFAULT_KS = [1, 10];
const SEED = 1;

/** Small by default: a phone could be the runtime, and a big base is slow. */
const DEFAULT_LOAD: LoadOptions = { nBase: 10000, nEval: 100, candWidth: 100, seed: SEED };

type View = "landing" | "playground" | "guide";

const HASH: Record<string, View> = {
  playground: "playground",
  guide: "guide",
};

/**
 * The view the current hash selects.
 *
 * A hash carries two things at once here: which view is showing, and which
 * heading to scroll to inside it. The guide's own table of contents links to
 * `#guide/why-quantize-at-all`, so read only the part before the slash --
 * otherwise following one of those anchors would drop back to the landing
 * page, the hash no longer matching any view.
 */
function viewFromHash(hash: string): View {
  return HASH[hash.replace(/^#/, "").split("/")[0]] ?? "landing";
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const view = viewFromHash(hash);

  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = next === "landing" ? "" : `#${next}`;
  }, []);

  // Scroll to the heading a `#guide/<id>` hash names.
  //
  // The browser cannot do this itself: the id it would look for is namespaced
  // under the view, and is not in the document until React has switched to it.
  // Keyed on the hash rather than the view, since moving between headings
  // changes only the hash -- and deferred a frame, so the target exists.
  useEffect(() => {
    const anchor = hash.split("/")[1];
    if (!anchor) {
      window.scrollTo({ top: 0 });
      return;
    }
    const frame = requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <NavBar view={view} onNavigate={navigate} />
      {view === "landing" && <Landing onOpenPlayground={() => navigate("playground")} />}
      {view === "playground" && <Playground />}
      {view === "guide" && <Guide />}
    </div>
  );
}

function Playground() {
  const [quantizers, setQuantizers] = useState<Quantizer[]>([]);
  const [primitives, setPrimitives] = useState<PrimitiveSpec[]>([]);
  const [mode, setMode] = useState<"family" | "custom">("family");
  const [stages, setStages] = useState<Stage[]>([]);
  // Several methods can run together, so the selection is a set. Params are
  // held per family, since each keeps its own even while another is expanded.
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>(["minmax"]);
  const [selectedSaved, setSelectedSaved] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, Record<string, string>>>({});
  const [expandedFamily, setExpandedFamily] = useState<string | null>("minmax");
  const [saved, setSaved] = useState<SavedQuantizer[]>([]);
  const [configText, setConfigText] = useState("");
  // Collapsed by default: the plot is the point, and the JSON is a detail most
  // sessions never need to open.
  const [configOpen, setConfigOpen] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string[]>(["sample"]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // Rows with an import in flight. The ref is what guards against a double
  // start: two clicks in the same tick would both see the same stale array.
  const [importing, setImporting] = useState<string[]>([]);
  const importingRef = useRef<Set<string>>(new Set());
  const [baseUrl, setBaseUrl] = useState("");
  const [loadOptions, setLoadOptions] = useState<LoadOptions>(DEFAULT_LOAD);

  // One result set per dataset the run covered, keyed by entry id.
  const [results, setResults] = useState<Record<string, MethodResult[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // The ids this run wrote, so the plot can tell earlier runs from the one it
  // is drawing as the subject. Ids carry a random offset to stay unique across
  // a multi-dataset run, so they do not compare reliably against a timestamp.
  const [currentRunIds, setCurrentRunIds] = useState<number[]>([]);
  // A saved run being read in a dialog. Separate from `results`, so opening
  // one does not disturb the run in progress.
  const [openRun, setOpenRun] = useState<RunRecord | null>(null);
  // Which datasets have the registered quantizers running, or already run.
  const [runningBenchmark, setRunningBenchmark] = useState<string[]>([]);
  const [benchmarkRun, setBenchmarkRun] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runner().listQuantizers(),
      runner().listPrimitives(),
      loadSampleDataset(),
      listRuns(),
    ])
      .then(([families, stageKinds, data, savedRuns]) => {
        if (cancelled) return;
        setQuantizers(families);
        setPrimitives(stageKinds);
        setRuns(savedRuns);
        // The sample is bundled, so it is ready the moment the page is. The
        // registry loads separately and may land first, so merge rather than
        // replace -- whichever arrives second must not drop the other.
        const entry = {
          ...sampleEntry(data.nBase, data.nEval, data.dim),
          dataset: data,
          scale: { sampled: data.nBase, total: data.nBase },
        };
        setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors([`startup failed: ${String(err)}`]);
      });

    listSavedQuantizers().then((all) => {
      if (!cancelled) setSaved(all);
    });

    // The importable list is a nicety; a failure must not block startup.
    loadRegistry()
      .then((registry) => {
        if (cancelled) return;
        setBaseUrl(registry.base_url);
        const rows = registry.datasets.map(benchmarkEntry);
        setEntries((prev) => [...prev, ...rows.filter((r) => !prev.some((e) => e.id === r.id))]);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // Every family gets its defaults up front, so switching which one is
  // expanded never loses what was typed into another.
  useEffect(() => {
    if (quantizers.length === 0) return;
    setParams((prev) => {
      const next = { ...prev };
      for (const family of quantizers) {
        next[family.key] ??= Object.fromEntries(
          family.params.map((p) => [p, defaultValue(p)]),
        );
      }
      return next;
    });
  }, [quantizers]);

  /** The stage list a composed pipeline describes, in config shape. */
  const composedStages = useMemo(
    () =>
      stages.map((stage) => {
        const out: { name: string; [param: string]: unknown } = { name: stage.key };
        for (const [param, raw] of Object.entries(stage.params)) {
          const value = toConfigValue(param, raw);
          if (value !== undefined) out[param] = value;
        }
        return out;
      }),
    [stages],
  );

  /**
   * The config the form describes: one method per selected quantizer. In
   * Compose mode the chain under construction is the method, so the built-in
   * selection steps aside -- otherwise pressing Run would silently include
   * whatever was ticked on the other tab.
   */
  const formConfig = useMemo(() => {
    const methods: Record<string, unknown>[] =
      mode === "custom"
        ? [{ name: "custom", stages: composedStages }]
        : [
            ...selectedSaved
              .map((name) => saved.find((q) => q.name === name))
              .filter((q): q is SavedQuantizer => q !== undefined)
              .map((q) => ({ name: q.name, stages: q.stages })),
            ...selectedFamilies.map((key) => {
              const method: Record<string, unknown> = { name: key };
              for (const [param, raw] of Object.entries(params[key] ?? {})) {
                const value = toConfigValue(param, raw);
                if (value !== undefined) method[param] = value;
              }
              return method;
            }),
          ];

    return {
      methods,
      metrics: DEFAULT_METRICS,
      k: DEFAULT_KS,
      seed: SEED,
      n_reconstruct: 200,
    };
  }, [mode, selectedFamilies, selectedSaved, saved, params, composedStages]);

  useEffect(() => {
    setConfigText(JSON.stringify(formConfig, null, 2));
  }, [formConfig]);

  const chosen = useMemo(
    () => entries.filter((e) => selected.includes(e.id)),
    [entries, selected],
  );
  // Validation needs a dimension; any loaded one will do, since each dataset is
  // validated again on its own before it runs.
  const validationDim = chosen.find((e) => e.dataset)?.dataset?.dim ?? 0;

  const validate = useCallback(
    async (config: string): Promise<string[]> => {
      try {
        const check = await runner().validate(config, validationDim);
        return check.ok ? [] : check.errors;
      } catch (err: unknown) {
        return [String(err)];
      }
    },
    [validationDim],
  );

  const report = useCallback(
    (id: string, stage: string, done: number, total: number) =>
      setProgress((prev) => ({ ...prev, [id]: { stage, done, total } })),
    [],
  );

  /**
   * Make sure an entry's vectors are in memory, reading them if not.
   *
   * Reading happens in the worker: a large parse would freeze the page, and the
   * remote reader's byte-range fetches use synchronous XHR, which browsers only
   * allow off the main thread.
   */
  const ensureLoaded = useCallback(
    async (entry: Entry): Promise<Entry> => {
      if (entry.dataset) return entry;
      const source =
        entry.source.kind === "custom"
          ? ({ kind: "file", file: entry.source.file } as const)
          : ({ kind: "url", url: datasetUrl(baseUrl, (entry.source as { remote: { name: string } }).remote.name) } as const);

      // On a loader worker of its own, so several imports overlap instead of
      // queueing behind one blocked event loop.
      const loaded = (await withLoader((api) =>
        api.loadDataset(
          source,
          loadOptions,
          Comlink.proxy((stage: string, done: number, total: number) =>
            report(entry.id, stage, done, total),
          ),
        ),
      )) as LoadedFile;

      const summary =
        `${loaded.summary.sampledBase.toLocaleString()} of ` +
        `${loaded.summary.fileBase.toLocaleString()} vectors · ${loaded.summary.dim}d · ` +
        `ground truth ${loaded.summary.groundTruth}`;
      const next: Entry = {
        ...entry,
        dataset: loaded.dataset,
        summary,
        scale: { sampled: loaded.summary.sampledBase, total: loaded.summary.fileBase },
      };
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? next : e)));
      return next;
    },
    [baseUrl, loadOptions, report],
  );

  const onImport = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry || entry.dataset) return;
      // Guard the row rather than the panel: another import may well be in
      // flight, and that is no reason to refuse this one.
      if (importingRef.current.has(id)) return;
      importingRef.current.add(id);
      setImporting((prev) => (prev.includes(id) ? prev : [...prev, id]));
      // A failed import leaves its own message; clear only that row's.
      setErrors((prev) => prev.filter((e) => !e.startsWith(`${entry.title}: `)));
      // Queued behind the pool's limit, the row would otherwise show nothing
      // at all between the click and the first byte.
      report(id, "waiting for a slot", 0, 0);
      try {
        await ensureLoaded(entry);
        // Ticking it is the obvious next step, so do it for them.
        setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } catch (err: unknown) {
        setErrors((prev) => [...prev, `${entry.title}: ${(err as Error).message ?? String(err)}`]);
      } finally {
        importingRef.current.delete(id);
        setImporting((prev) => prev.filter((x) => x !== id));
        // Drop the bar either way: on success the row is ticked and the
        // summary says what landed, and on failure it must offer `import`
        // again rather than sticking on "importing…".
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [ensureLoaded, entries, report],
  );

  /** Keep the composed chain under a name, so it can be run again later. */
  const onSavePipeline = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed === "" || composedStages.length === 0) return;
      await saveQuantizer({ name: trimmed, stages: composedStages, savedAt: Date.now() });
      setSaved(await listSavedQuantizers());
      // Selecting it and returning to the list is the obvious next step.
      setSelectedSaved((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setMode("family");
    },
    [composedStages],
  );

  const onDeleteSaved = useCallback(async (name: string) => {
    await deleteQuantizer(name);
    setSaved(await listSavedQuantizers());
    setSelectedSaved((prev) => prev.filter((n) => n !== name));
  }, []);

  const onAddFile = useCallback((file: File) => {
    const entry = customEntry(file);
    // The file joins the list like any other row -- unticked, with an `import`
    // button -- so opening a 2 GB file by mistake costs nothing until asked.
    setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
  }, []);

  /**
   * Run every registered vq-bench quantizer on one dataset's vectors.
   *
   * The published figures were measured over each dataset's full base; these
   * are the same methods over the rows actually loaded here, which is what
   * makes the comparison apples-to-apples.
   */
  const onRunBenchmarkMethods = useCallback(
    async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      const vectors = entry?.dataset;
      if (!entry || !vectors) return;

      setRunningBenchmark((prev) => [...prev, entryId]);
      try {
        const config = JSON.stringify({
          methods: quantizers.map((q) => ({
            name: q.key,
            // Defaults, so this reproduces the registry rather than whatever
            // the reader happens to have typed on the left.
            ...Object.fromEntries(
              q.params
                .map((param) => [param, toConfigValue(param, defaultValue(param))])
                .filter(([, value]) => value !== undefined),
            ),
          })),
          metrics: DEFAULT_METRICS,
          k: DEFAULT_KS,
          seed: SEED,
          n_reconstruct: 200,
        });
        const out = await runner().run(config, vectors);
        if (!out.ok) {
          setErrors(out.errors.map((e) => `${entry.title}: ${e}`));
          return;
        }
        // Merge, so the reader's own run stays alongside the reference set.
        setResults((prev) => ({
          ...prev,
          [entryId]: dedupeByLabel([...(prev[entryId] ?? []), ...out.results]),
        }));
        setBenchmarkRun((prev) => [...prev, entryId]);
      } catch (err: unknown) {
        setErrors([`${entry.title}: ${(err as Error).message ?? String(err)}`]);
      } finally {
        setRunningBenchmark((prev) => prev.filter((id) => id !== entryId));
      }
    },
    [entries, quantizers],
  );

  const onRun = useCallback(async () => {
    if (chosen.length === 0) {
      setErrors(["Select at least one dataset to run against."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setResults({});
    setProgress({});
    setBenchmarkRun([]);
    const started = performance.now();
    const collected: Record<string, MethodResult[]> = {};
    const problems: string[] = [];

    try {
      // Sequential rather than parallel: one wasm worker, and running several
      // datasets at once would only interleave their progress confusingly.
      for (const entry of chosen) {
        try {
          // Only imported datasets are selectable, so this is a guard, not a
          // path the UI can reach.
          const vectors = entry.dataset;
          if (!vectors) continue;

          report(entry.id, "validating", 0, 0);
          const check = await runner().validate(configText, vectors.dim);
          if (!check.ok) {
            problems.push(...check.errors.map((e) => `${entry.title}: ${e}`));
            continue;
          }

          report(entry.id, "running", 0, 0);
          const out = await runner().run(configText, vectors);
          if (!out.ok) {
            problems.push(...out.errors.map((e) => `${entry.title}: ${e}`));
            continue;
          }
          collected[entry.id] = out.results;
          report(entry.id, "done", 1, 1);
        } catch (err: unknown) {
          problems.push(`${entry.title}: ${(err as Error).message ?? String(err)}`);
        }
      }

      const seconds = (performance.now() - started) / 1000;
      setResults(collected);
      setErrors(problems);
      setElapsed(seconds);

      // One stored run per dataset, so each carries the reference curve it
      // should be read against.
      const written: number[] = [];
      for (const [id, rows] of Object.entries(collected)) {
        const entry = entries.find((e) => e.id === id);
        const runId = Date.now() + written.length;
        written.push(runId);
        await saveRun({
          id: runId,
          config: configText,
          dataset: entry?.title ?? id,
          benchmarkDataset: entry?.benchmarkKey ?? null,
          // Keyed by the row it ran on, so reopening it lands in the same
          // panel -- with the same reference curves -- as a fresh run would.
          datasetId: id,
          scale: entry?.scale,
          results: rows,
          elapsedSeconds: seconds,
        });
      }
      setCurrentRunIds(written);
      setRuns(await listRuns());
    } finally {
      setBusy(false);
      // Leave the bars up: they say which datasets the results came from.
    }
  }, [chosen, configText, entries, report]);

  const ready = quantizers.length > 0 && entries.length > 0;
  const methodCount =
    mode === "custom" ? 1 : selectedFamilies.length + selectedSaved.length;
  const resultEntries = Object.entries(results);

  return (
    <div className="mx-auto max-w-[110rem] px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-6">
          <Panel title="Quantizer">
            <div className="mb-3 flex gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
              {(["family", "custom"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setMode(option)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                    mode === option
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {option === "family" ? "Built-in" : "Compose"}
                </button>
              ))}
            </div>

            {!ready ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : mode === "family" ? (
              <>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    {methodCount} method{methodCount === 1 ? "" : "s"} selected
                  </span>
                  <span className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedFamilies(quantizers.map((q) => q.key));
                        setSelectedSaved(saved.map((q) => q.name));
                      }}
                      className="text-slate-500 dark:text-slate-400 underline hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      all
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFamilies([]);
                        setSelectedSaved([]);
                      }}
                      className="text-slate-500 dark:text-slate-400 underline hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      none
                    </button>
                  </span>
                </div>
                <MethodPicker
                  quantizers={quantizers}
                  saved={saved}
                  selected={selectedFamilies}
                  selectedSaved={selectedSaved}
                  params={params}
                  expanded={expandedFamily}
                  onToggle={(key) =>
                    setSelectedFamilies((prev) =>
                      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                    )
                  }
                  onToggleSaved={(name) =>
                    setSelectedSaved((prev) =>
                      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                    )
                  }
                  onExpand={setExpandedFamily}
                  onParamChange={(key, param, value) =>
                    setParams((prev) => ({
                      ...prev,
                      [key]: { ...(prev[key] ?? {}), [param]: value },
                    }))
                  }
                  onDeleteSaved={onDeleteSaved}
                />
              </>
            ) : (
              <>
                <PipelineBuilder primitives={primitives} stages={stages} onChange={setStages} />
                <SavePipeline
                  disabled={composedStages.length === 0}
                  onSave={onSavePipeline}
                />
              </>
            )}
          </Panel>

          <Panel
            title="Datasets"
            aside={selected.length > 1 ? `${selected.length} selected` : undefined}
          >
            <DatasetList
              entries={entries}
              selected={selected}
              progress={progress}
              disabled={busy}
              importing={importing}
              onToggle={(id) =>
                setSelected((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
              onImport={onImport}
              onAddFile={onAddFile}
            />

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <SampleSize
                label="n_base"
                hint="rows"
                value={loadOptions.nBase}
                onChange={(nBase) => setLoadOptions((o) => ({ ...o, nBase }))}
              />
              <SampleSize
                label="n_eval"
                hint="queries"
                value={loadOptions.nEval}
                onChange={(nEval) => setLoadOptions((o) => ({ ...o, nEval }))}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Applies when a dataset is first read. Rows are sampled uniformly at random,
              seeded — the same dataset and settings give the same subset.
            </p>
          </Panel>

          <Panel title="History">
            <RunHistory
              runs={runs}
              onOpen={setOpenRun}
              onRestore={(run) => {
                setConfigText(run.config);
                // Key by the row it ran on where that is known, so the panel
                // finds the dataset and draws the right reference curves.
                // Older records predate the field and fall back to a synthetic
                // key, which still shows the table.
                setResults({ [run.datasetId ?? `saved:${run.id}`]: run.results });
                setElapsed(run.elapsedSeconds);
                setErrors([]);
              }}
              onDelete={async (id) => {
                await deleteRun(id);
                setRuns(await listRuns());
              }}
              onClear={async () => {
                await clearRuns();
                setRuns([]);
              }}
            />
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <button
            onClick={onRun}
            disabled={busy || !ready}
            className="w-full rounded-md border border-transparent bg-slate-900 px-4 py-2.5
                       text-sm font-medium text-white hover:bg-slate-700
                       disabled:cursor-not-allowed disabled:bg-slate-300
                       dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100
                       dark:hover:border-slate-400 dark:hover:bg-slate-700
                       dark:disabled:border-slate-800 dark:disabled:bg-slate-900
                       dark:disabled:text-slate-600"
          >
            {busy
              ? "Running…"
              : `Run ${methodCount} method${methodCount === 1 ? "" : "s"} on ` +
                `${selected.length} dataset${selected.length === 1 ? "" : "s"}`}
          </button>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h2 className="text-base text-red-800">
                {errors.length === 1 ? "A problem" : `${errors.length} problems`}
              </h2>
              <ul className="mt-2 space-y-1">
                {errors.map((error) => (
                  <li key={error} className="font-mono text-xs break-words text-red-700">
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* One results block per dataset, each named and each plotted against
              its own reference curves -- a single merged table would hide which
              dataset a number came from. */}
          {/* One panel per dataset. Several runs grid rather than stack: the
              comparison across datasets is the point, and a column of
              full-width panels puts them a scroll apart. A single result keeps
              the full width, where the chart has room to breathe. */}
          <div
            className={
              resultEntries.length > 1
                ? "grid items-start gap-6 xl:grid-cols-2 2xl:grid-cols-3"
                : "space-y-6"
            }
          >
          {resultEntries.map(([id, rows]) => {
            const entry = entries.find((e) => e.id === id);
            const title = entry?.title ?? "saved run";
            return (
              <Panel
                key={id}
                title={title}
                aside={elapsed !== null ? `${elapsed.toFixed(2)}s total` : undefined}
              >
                {/* The ranked table already carries this run's metrics beside
                    the published ones, so the plain table would repeat it. */}
                <SotaOverlay
                  results={rows}
                  k={DEFAULT_KS[DEFAULT_KS.length - 1]}
                  benchmarkDataset={entry?.benchmarkKey ?? null}
                  datasetLabel={title}
                  // Everything but this run, which is drawn as the subject.
                  history={runs.filter((r) => !currentRunIds.includes(r.id))}
                  metricsTable={<ResultsTable results={rows} compact={resultEntries.length > 1} />}
                  scale={entry?.scale}
                  compact={resultEntries.length > 1}
                  onRunBenchmarkMethods={
                    entry?.dataset ? () => onRunBenchmarkMethods(id) : undefined
                  }
                  runningBenchmarkMethods={runningBenchmark.includes(id)}
                  benchmarkMethodsRun={benchmarkRun.includes(id)}
                />
              </Panel>
            );
          })}
          </div>

          <section className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <details open={configOpen} onToggle={(e) => setConfigOpen(e.currentTarget.open)}>
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
                Config
                <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                  {configOpen ? "" : "the JSON this run sends to vq-bench"}
                </span>
              </summary>
              <div className="px-5 pb-5">
                <ConfigEditor value={configText} onChange={setConfigText} validate={validate} />
              </div>
            </details>
          </section>
        </div>
      </div>

      {openRun && (
        <RunDetail run={openRun} history={runs} onClose={() => setOpenRun(null)} />
      )}
    </div>
  );
}

/** Keep the first row for each label; a reference run may repeat the reader's. */
function dedupeByLabel(rows: MethodResult[]): MethodResult[] {
  const seen = new Map<string, MethodResult>();
  for (const row of rows) if (!seen.has(row.label)) seen.set(row.label, row);
  return [...seen.values()];
}

/** Naming a composed pipeline so it can be run again later. */
function SavePipeline({
  disabled,
  onSave,
}: {
  disabled: boolean;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name);
        setName("");
      }}
      className="mt-4 flex gap-2 border-t border-slate-100 dark:border-slate-800 pt-3"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name this pipeline"
        aria-label="pipeline name"
        className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={disabled || name.trim() === ""}
        className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:border-slate-500 dark:hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        save
      </button>
    </form>
  );
}

/** A sample-size field; both are plain positive integers. */
function SampleSize({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">{hint}</span>
      </span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
      />
    </label>
  );
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base text-slate-700 dark:text-slate-300">{title}</h2>
        {aside && <span className="text-xs text-slate-500 dark:text-slate-400">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
