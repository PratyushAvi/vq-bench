// Composing a quantizer from primitives.
//
// A pipeline is a linear chain: each stage transforms the vectors and hands
// them to the next. The palette comes from `list_primitives()`, so a primitive
// added upstream shows up here without a change to this file.
//
// Nothing is validated here -- the chain is checked by `validate_config`, which
// builds it through vq-bench and reports that crate's own errors.

import type { PrimitiveSpec, Stage } from "../lib/types";
import { defaultValue, shapeOf } from "../lib/params";

type Props = {
  primitives: PrimitiveSpec[];
  stages: Stage[];
  onChange: (stages: Stage[]) => void;
};

let nextId = 1;

/** Rounders are what actually quantize; a chain without one only conditions. */
const ROUNDERS = /^(cast_|kmeans$)/;

function endsInRounder(stages: Stage[]): boolean {
  return stages.some((s) => ROUNDERS.test(s.key));
}

export function PipelineBuilder({ primitives, stages, onChange }: Props) {
  const specOf = (key: string) => primitives.find((p) => p.key === key);

  function addStage(key: string) {
    const spec = specOf(key);
    if (!spec) return;
    onChange([
      ...stages,
      {
        id: nextId++,
        key,
        params: Object.fromEntries(spec.params.map((p) => [p, defaultValue(p)])),
      },
    ]);
  }

  function update(id: number, change: Partial<Stage>) {
    onChange(stages.map((s) => (s.id === id ? { ...s, ...change } : s)));
  }

  function move(index: number, by: number) {
    const to = index + by;
    if (to < 0 || to >= stages.length) return;
    const next = [...stages];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {stages.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          An empty pipeline. Add a stage below — a chain usually ends in a rounder
          (<span className="font-mono">cast_*</span> or <span className="font-mono">kmeans</span>),
          which is what actually quantizes.
        </p>
      )}

      <ol className="space-y-2">
        {stages.map((stage, index) => {
          const spec = specOf(stage.key);
          return (
            <li key={stage.id} className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2">
              <div className="flex items-center gap-1.5">
                <span className="w-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{index + 1}</span>
                <select
                  value={stage.key}
                  onChange={(e) => {
                    const spec = specOf(e.target.value);
                    update(stage.id, {
                      key: e.target.value,
                      params: Object.fromEntries(
                        (spec?.params ?? []).map((p) => [p, defaultValue(p)]),
                      ),
                    });
                  }}
                  className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                >
                  {primitives.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="move stage up"
                  className="px-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-25"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === stages.length - 1}
                  aria-label="move stage down"
                  className="px-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-25"
                >
                  ↓
                </button>
                <button
                  onClick={() => onChange(stages.filter((s) => s.id !== stage.id))}
                  aria-label="remove stage"
                  className="px-1 text-xs text-slate-500 dark:text-slate-400 hover:text-red-700"
                >
                  ×
                </button>
              </div>

              {spec && (
                <p className="mt-1 pl-6 text-xs leading-snug text-slate-500 dark:text-slate-400">{spec.describe}</p>
              )}

              {spec && spec.params.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
                  {spec.params.map((param) => {
                    const shape = shapeOf(param);
                    return (
                      <label key={param} className="flex items-center gap-1">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{param}</span>
                        {shape.kind === "choice" ? (
                          <select
                            value={stage.params[param] ?? ""}
                            onChange={(e) =>
                              update(stage.id, {
                                params: { ...stage.params, [param]: e.target.value },
                              })
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
                            value={stage.params[param] ?? ""}
                            onChange={(e) =>
                              update(stage.id, {
                                params: { ...stage.params, [param]: e.target.value },
                              })
                            }
                            aria-label={`${stage.key} ${param}`}
                            // A comma-separated list sweeps, as it does for a
                            // built-in family, so the field has to be wide
                            // enough to show one.
                            title="one value, or a comma-separated sweep"
                            className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-xs
                                       focus:border-slate-500 focus:outline-none
                                       dark:border-slate-600"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {stages.length > 0 && !endsInRounder(stages) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This chain has no rounder, so nothing is actually quantized — it will run, but
          the codes carry the vectors at full precision. Add a{" "}
          <span className="font-mono">cast_*</span> or{" "}
          <span className="font-mono">kmeans</span> stage at the end.
        </p>
      )}

      <select
        value=""
        onChange={(e) => e.target.value && addStage(e.target.value)}
        aria-label="add a stage"
        className="w-full cursor-pointer rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 focus:border-slate-500 focus:outline-none"
      >
        <option value="">+ add a stage…</option>
        {primitives.map((p) => (
          <option key={p.key} value={p.key}>
            {p.key} — {p.describe}
          </option>
        ))}
      </select>
    </div>
  );
}
