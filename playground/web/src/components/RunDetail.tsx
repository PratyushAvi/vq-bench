// One saved run, reopened.
//
// A run in the history is a finished experiment: it already carries its
// results, the dataset it ran on, and the scale it ran at. Showing it in a
// dialog rather than replacing the main results means reading an old run costs
// nothing -- the work in progress is still there when it closes.

import { useEffect, useRef } from "react";

import { ResultsTable } from "./ResultsTable";
import { SotaOverlay } from "./SotaOverlay";
import type { RunRecord } from "../lib/history";

type Props = {
  run: RunRecord;
  /** Every stored run, so the chart can draw earlier ones on this dataset. */
  history: RunRecord[];
  onClose: () => void;
};

export function RunDetail({ run, history, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog so a keyboard reader is not
  // left behind on the list underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const when = new Date(run.id).toLocaleString();

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-[1px]"
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`run on ${run.dataset}, ${when}`}
        tabIndex={-1}
        // The backdrop closes; the panel itself must not.
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base text-slate-900 dark:text-slate-100">{run.dataset}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {when} · {run.elapsedSeconds.toFixed(2)}s ·{" "}
              {run.results.length} result{run.results.length === 1 ? "" : "s"}
              {run.scale
                ? ` · ${run.scale.sampled.toLocaleString()} of ${run.scale.total.toLocaleString()} vectors`
                : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="shrink-0 rounded px-2 py-1 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <SotaOverlay
            results={run.results}
            benchmarkDataset={run.benchmarkDataset ?? null}
            datasetLabel={run.dataset}
            // Everything except this run, which is drawn as the subject.
            history={history.filter((r) => r.id !== run.id)}
            metricsTable={<ResultsTable results={run.results} />}
            scale={run.scale}
          />
        </div>
      </div>
    </div>
  );
}
