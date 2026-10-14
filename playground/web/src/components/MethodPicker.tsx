// Choosing what to run: one or more built-in families, plus any pipelines the
// reader has saved.
//
// Families and their param names come from the wasm registry, so this stays
// correct as vq-bench gains methods. Saved pipelines are the reader's own,
// kept in the browser.

import type { Quantizer } from "../lib/types";
import type { SavedQuantizer } from "../lib/history";
import { shapeOf } from "../lib/params";

type Props = {
  quantizers: Quantizer[];
  saved: SavedQuantizer[];
  /** Family keys selected to run. */
  selected: string[];
  /** Saved pipeline names selected to run. */
  selectedSaved: string[];
  /** Params per family key. Only the expanded family shows inputs. */
  params: Record<string, Record<string, string>>;
  /** Which family's params are open; only one at a time keeps the panel short. */
  expanded: string | null;
  onToggle: (key: string) => void;
  onToggleSaved: (name: string) => void;
  onExpand: (key: string | null) => void;
  onParamChange: (key: string, param: string, value: string) => void;
  onDeleteSaved: (name: string) => void;
};

export function MethodPicker({
  quantizers,
  saved,
  selected,
  selectedSaved,
  params,
  expanded,
  onToggle,
  onToggleSaved,
  onExpand,
  onParamChange,
  onDeleteSaved,
}: Props) {
  return (
    <div className="space-y-3">
      {saved.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Saved
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {saved.map((pipeline) => (
              <li key={pipeline.name} className="flex items-center gap-2 py-1.5">
                <input
                  type="checkbox"
                  checked={selectedSaved.includes(pipeline.name)}
                  onChange={() => onToggleSaved(pipeline.name)}
                  aria-label={`run ${pipeline.name}`}
                  className="rounded border-slate-300 dark:border-slate-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{pipeline.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {pipeline.stages.map((s) => s.name).join(" → ")}
                  </p>
                </div>
                <button
                  onClick={() => onDeleteSaved(pipeline.name)}
                  aria-label={`delete ${pipeline.name}`}
                  className="px-1 text-xs text-slate-500 dark:text-slate-400 hover:text-red-700"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        {saved.length > 0 && (
          <h3 className="mb-1 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Built-in
          </h3>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {quantizers.map((family) => {
            const isSelected = selected.includes(family.key);
            const isOpen = expanded === family.key;
            return (
              <li key={family.key} className="py-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(family.key)}
                    aria-label={`run ${family.family}`}
                    className="rounded border-slate-300 dark:border-slate-600"
                  />
                  <button
                    onClick={() => onExpand(isOpen ? null : family.key)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                      {family.family}
                      {family.params.length > 0 && (
                        <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                          {family.params
                            .map((p) => `${p}=${params[family.key]?.[p] ?? ""}`)
                            .join(", ")}
                        </span>
                      )}
                    </span>
                  </button>
                  {family.params.length > 0 && (
                    <button
                      onClick={() => onExpand(isOpen ? null : family.key)}
                      aria-label={`${isOpen ? "hide" : "show"} ${family.family} parameters`}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-1.5 space-y-2 pl-6">
                    <p className="font-mono text-xs leading-snug text-slate-500 dark:text-slate-400">
                      {family.describe}
                    </p>
                    {family.params.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No parameters.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {family.params.map((param) => {
                          const shape = shapeOf(param);
                          const value = params[family.key]?.[param] ?? "";
                          return (
                            <label key={param} className="flex items-center gap-1">
                              <span className="text-xs text-slate-500 dark:text-slate-400">{param}</span>
                              {shape.kind === "choice" ? (
                                <select
                                  value={value}
                                  onChange={(e) =>
                                    onParamChange(family.key, param, e.target.value)
                                  }
                                  className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs focus:border-slate-500 focus:outline-none"
                                >
                                  {shape.options.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={value}
                                  inputMode={shape.kind === "int" ? "numeric" : "text"}
                                  onChange={(e) =>
                                    onParamChange(family.key, param, e.target.value)
                                  }
                                  className="w-20 rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-xs focus:border-slate-500 focus:outline-none"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {family.params.some((p) => shapeOf(p).kind === "int") && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        one value, or a comma-separated sweep
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
