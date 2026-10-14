// Past runs, kept in IndexedDB on this device.

import type { RunRecord } from "../lib/history";

type Props = {
  runs: RunRecord[];
  /** Open the run's own results -- its table and plot -- without disturbing
   *  whatever is on the page. */
  onOpen: (run: RunRecord) => void;
  /** Load the run's config back into the editor, to run it again. */
  onRestore: (run: RunRecord) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
};

/** The methods a run covered, short enough for one line. */
function summarize(run: RunRecord): string {
  const labels = run.results.map((r) => r.label);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

export function RunHistory({ runs, onOpen, onRestore, onDelete, onClear }: Props) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        No saved runs yet. Every run you make is kept here, on this device.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {runs.length} run{runs.length === 1 ? "" : "s"} on this device
        </span>
        <button onClick={onClear} className="text-xs text-slate-500 dark:text-slate-400 underline hover:text-red-700">
          clear all
        </button>
      </div>

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {runs.map((run) => (
          <li key={run.id} className="group flex items-start gap-2 py-2">
            {/* The row opens the run's own results. Re-running it is the rarer
                intent, so that gets its own control rather than the whole row. */}
            <button
              onClick={() => onOpen(run)}
              title="show this run's table and plot"
              className="min-w-0 flex-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {summarize(run)}
              </p>
              <p className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                {new Date(run.id).toLocaleString()} · {run.elapsedSeconds.toFixed(2)}s
              </p>
              {/* The dataset is what a run is read against, so it gets its own
                  line rather than being buried in the timestamp row. */}
              <p className="mt-0.5 truncate text-xs font-medium text-slate-600 dark:text-slate-400">
                {run.dataset}
                {run.scale && (
                  <span className="font-normal text-slate-500 dark:text-slate-400">
                    {" "}
                    · {run.scale.sampled.toLocaleString()} of{" "}
                    {run.scale.total.toLocaleString()} vectors
                  </span>
                )}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={() => onRestore(run)}
                title="load this config back into the editor"
                aria-label="load this run's config"
                className="cursor-pointer rounded px-1.5 py-0.5 text-base leading-none text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
              >
                ↻
              </button>
              <button
                onClick={() => onDelete(run.id)}
                aria-label="delete run"
                className="cursor-pointer rounded px-1.5 py-0.5 text-base leading-none text-slate-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-700"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
