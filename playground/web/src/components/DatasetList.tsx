// The one place a run is pointed at data.
//
// The bundled sample sits at the top, the benchmark datasets follow, and any
// file the reader opens joins the same list. Several can be selected at once,
// and each shows its own progress while a run is in flight -- with more than
// one dataset, "running…" on a single button says nothing about where the time
// is going.

import { useRef, useState } from "react";

import type { Entry, Progress } from "../lib/datasets-panel";

// h5wasm holds an opened local file entirely in memory (no byte-range endpoint
// to read it lazily), and wasm32 addresses at most 4 GB.
const WARN_BYTES = 500 * 1024 * 1024;

type Props = {
  entries: Entry[];
  selected: string[];
  progress: Record<string, Progress>;
  /** A run is in flight: the selection is fixed for its duration. */
  disabled: boolean;
  /** Rows with an import in flight, which may be several at once. */
  importing: string[];
  onToggle: (id: string) => void;
  onImport: (id: string) => void;
  onAddFile: (file: File) => void;
};

export function DatasetList({
  entries,
  selected,
  progress,
  disabled,
  importing,
  onToggle,
  onImport,
  onAddFile,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [oversize, setOversize] = useState<string | null>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    setOversize(
      file.size > WARN_BYTES
        ? `${(file.size / 1048576).toFixed(0)} MB is large for an in-browser load — ` +
          `a benchmark dataset of this size would stream instead, but a local file ` +
          `has to be held whole.`
        : null,
    );
    onAddFile(file);
    setDropOpen(false);
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {entries.map((entry) => {
          const isSelected = selected.includes(entry.id);
          const bar = progress[entry.id];
          // Only an imported dataset can be ticked: until its vectors are read
          // there is nothing to run against, and a tick would promise otherwise.
          const imported = entry.dataset !== undefined;
          const inFlight = importing.includes(entry.id);
          return (
            <li key={entry.id} className="py-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled || !imported}
                  onChange={() => onToggle(entry.id)}
                  aria-label={`use ${entry.title}`}
                  title={imported ? undefined : "import this dataset first"}
                  className="mt-0.5 rounded border-slate-300 dark:border-slate-600 disabled:opacity-30"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-xs ${
                      imported
                        ? "font-semibold text-slate-900 dark:text-slate-100"
                        : "font-medium text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {entry.title}
                  </p>
                  {/* Detail sits below its title at the same readable colour;
                      the weight difference is what separates them. */}
                  <p className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {entry.summary ?? entry.detail}
                  </p>
                </div>
                {!imported && (
                  <button
                    onClick={() => onImport(entry.id)}
                    // Only this row's own import disables it. Another dataset
                    // downloading is no reason to refuse this one -- imports
                    // run on workers of their own.
                    disabled={inFlight}
                    className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:border-slate-500 dark:hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inFlight ? "importing…" : "import"}
                  </button>
                )}
              </div>

              {bar && (
                <div className="mt-1.5 pl-6">
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                    role="progressbar"
                    aria-valuenow={bar.total > 0 ? Math.round((bar.done / bar.total) * 100) : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${entry.title}: ${bar.stage}`}
                  >
                    <div
                      className="h-full rounded-full bg-slate-700 transition-[width] duration-200"
                      style={{
                        width: bar.total > 0 ? `${(bar.done / bar.total) * 100}%` : "100%",
                        // An indeterminate stage still reads as activity.
                        opacity: bar.total > 0 ? 1 : 0.4,
                      }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{bar.stage}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!dropOpen ? (
        <button
          onClick={() => setDropOpen(true)}
          className="w-full rounded-md border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          + use your own .h5
        </button>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed p-4 text-center
                      transition-colors ${
                        dragging
                          ? "border-slate-500 bg-slate-100 dark:bg-slate-800"
                          : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500"
                      }`}
        >
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Drop an <span className="font-mono">.h5</span> here, or click to choose
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            base/eval or train/test layouts · stays on your device
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDropOpen(false);
            }}
            className="mt-2 text-xs text-slate-500 dark:text-slate-400 underline hover:text-slate-700 dark:hover:text-slate-300"
          >
            cancel
          </button>
          <input
            ref={input}
            type="file"
            accept=".h5,.hdf5"
            className="hidden"
            onChange={(e) => accept(e.target.files?.[0])}
          />
        </div>
      )}

      {oversize && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{oversize}</p>
      )}
    </div>
  );
}
