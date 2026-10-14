// Stages under construction <-> the stage lists a config carries.
//
// The builder holds raw input text so a half-typed value survives; the config
// wants typed values. A splitter's `branch` chain nests the same shape.

import type { PrimitiveSpec, Stage } from "./types";
import { defaultValue, toConfigValue } from "./params";

/** A stage as a config carries it. */
export type ConfigStage = {
  name: string;
  branch?: ConfigStage[];
  [param: string]: unknown;
};

let nextId = 1;

/** A fresh stage of kind `spec`, with default params and (for a splitter) an empty branch. */
export function newStage(spec: PrimitiveSpec): Stage {
  return {
    id: nextId++,
    key: spec.key,
    params: Object.fromEntries(spec.params.map((p) => [p, defaultValue(p)])),
    ...(spec.splitter ? { branch: [] } : {}),
  };
}

export function toConfigStages(stages: Stage[]): ConfigStage[] {
  return stages.map((stage) => {
    const out: ConfigStage = { name: stage.key };
    for (const [param, raw] of Object.entries(stage.params)) {
      const value = toConfigValue(param, raw);
      if (value !== undefined) out[param] = value;
    }
    if (stage.branch) out.branch = toConfigStages(stage.branch);
    return out;
  });
}

/** Load a saved config back into the builder. A sweep (an array) becomes `2, 4`. */
export function fromConfigStages(stages: ConfigStage[]): Stage[] {
  return stages.map((cfg) => {
    const { name, branch, ...params } = cfg;
    return {
      id: nextId++,
      key: name,
      params: Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
      ),
      ...(branch ? { branch: fromConfigStages(branch) } : {}),
    };
  });
}
