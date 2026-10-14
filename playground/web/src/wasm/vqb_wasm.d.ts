/* tslint:disable */
/* eslint-disable */

/**
 * Every metric this build can report, with a one-line description.
 */
export function list_metrics(): string;

/**
 * Every primitive a custom pipeline can name: key, display name, params, and
 * a one-line description.
 *
 * Read from the registry, so a primitive added upstream appears in the builder
 * without a change here. Splitters are absent: they fan out into branch
 * pipelines, which a linear chain cannot express.
 */
export function list_primitives(): string;

/**
 * Every quantizer family: key, display name, accepted params, description.
 *
 * Read from the registry rather than hardcoded, so syncing the fork with
 * upstream picks up new families for free.
 */
export function list_quantizers(): string;

/**
 * Run a config against vectors parsed in JS.
 *
 * `base` and `eval` are row-major f32 of shape `n x dim`. `candidates` is one
 * flat u32 array of row indices into `base`, `cand_width` per query -- a flat
 * layout because it crosses the wasm boundary as one typed array.
 */
export function run(config_json: string, base: Float32Array, _eval: Float32Array, dim: number, candidates: Uint32Array, cand_width: number): string;

/**
 * Exact top-`l` neighbors for each query, as a flat `n_eval * l` index array.
 *
 * A dataset that ships no ground truth needs this before it can be scored
 * against. It is the same block-folded search the native CLI runs, so the
 * candidate pools a browser builds match the ones `vqb data get` would write.
 *
 * `on_progress` is called with `(rows_done, rows_total)` as the base is folded
 * in; pass `null` for none. The search is O(n_base * n_eval * dim), so a large
 * base takes real time -- run it in a worker and show the progress.
 */
export function top_neighbors(base: Float32Array, _eval: Float32Array, dim: number, l: number, on_progress?: Function | null): Uint32Array;

/**
 * The dry run: check the config parses, and that every quantizer, param, and
 * metric it names is real -- without computing anything.
 *
 * Returns `{"ok": true}` or `{"ok": false, "errors": [...]}`. Param *values*
 * are checked by the quantizer's own `build`, so this needs a dimension to
 * build against; `dim` may be 0 when it is not yet known, which skips that
 * deeper check and validates names only.
 */
export function validate_config(config_json: string, dim: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly list_metrics: () => [number, number];
    readonly list_primitives: () => [number, number];
    readonly list_quantizers: () => [number, number];
    readonly run: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly top_neighbors: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly validate_config: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
