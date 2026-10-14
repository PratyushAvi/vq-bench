// Shapes crossing the wasm boundary. These mirror what the Rust side emits --
// see crates/vqb-wasm/src/lib.rs -- rather than describing anything JS owns.

/** One quantizer family, as reported by `list_quantizers()`. */
export type Quantizer = {
  key: string;
  family: string;
  params: string[];
  describe: string;
};

/** One composable pipeline stage, as reported by `list_primitives()`. */
export type PrimitiveSpec = {
  key: string;
  display: string;
  params: string[];
  describe: string;
};

/** One stage in a pipeline under construction. Values are the raw input text. */
export type Stage = {
  /** Stable across reorders, so React keys survive drag and drop. */
  id: number;
  key: string;
  params: Record<string, string>;
};

/** One metric, as reported by `list_metrics()`. */
export type Metric = {
  name: string;
  describe: string;
};

/** The vectors a run needs, already parsed out of the dataset files. */
export type Dataset = {
  base: Float32Array;
  eval: Float32Array;
  candidates: Uint32Array;
  dim: number;
  candWidth: number;
  nBase: number;
  nEval: number;
};

/** `validate_config` returns either ok, or the reasons it is not. */
export type ValidationResponse = { ok: true } | { ok: false; errors: string[] };

/**
 * One method's scores. Metric values are nested by k (`recall`, `sos`) or by
 * temperature (`kl`, `tv`), or are plain numbers (`mse_score`), so the value
 * type stays open rather than pretending to know which.
 */
export type MethodResult = {
  label: string;
  bits_per_dim: number;
  [metric: string]: number | Record<string, unknown> | string;
};

export type RunResponse =
  | { ok: true; results: MethodResult[] }
  | { ok: false; errors: string[] };
