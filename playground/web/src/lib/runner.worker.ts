// The wasm module runs here, off the UI thread, so a slow run never freezes the
// page. Comlink turns the postMessage plumbing into plain awaited calls.

import * as Comlink from "comlink";
import init, {
  list_quantizers,
  list_metrics,
  list_primitives,
  validate_config,
  run,
  top_neighbors,
} from "../wasm/vqb_wasm.js";
import wasmUrl from "../wasm/vqb_wasm_bg.wasm?url";

import { loadH5, loadRemoteH5, type LoadOptions, type LoadedFile } from "./h5";
import type { Dataset, RunResponse, ValidationResponse } from "./types";

/** Instantiate once; every later call reuses the same module. */
const ready = init({ module_or_path: wasmUrl });

const api = {
  async listQuantizers() {
    await ready;
    return JSON.parse(list_quantizers());
  },

  async listMetrics() {
    await ready;
    return JSON.parse(list_metrics());
  },

  async listPrimitives() {
    await ready;
    return JSON.parse(list_primitives());
  },

  async validate(config: string, dim: number): Promise<ValidationResponse> {
    await ready;
    return JSON.parse(validate_config(config, dim));
  },

  /**
   * Exact top-`l` neighbors, for a dataset that ships no ground truth. The
   * progress callback arrives from the UI thread as a Comlink proxy, so it is
   * invoked rather than called directly.
   */
  async topNeighbors(
    base: Float32Array,
    evalQueries: Float32Array,
    dim: number,
    l: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Uint32Array> {
    await ready;
    const report = onProgress
      ? (done: number, total: number) => void onProgress(done, total)
      : undefined;
    return top_neighbors(base, evalQueries, dim, l, report);
  },

  /**
   * Read a dataset -- a file the user picked, or a URL fetched by byte range.
   *
   * This runs in the worker for two reasons: a big parse would otherwise freeze
   * the page, and `createLazyFile` uses synchronous XHR, which browsers forbid
   * on the main thread. Ground truth, when the file ships none, is computed
   * here too rather than round-tripping the vectors back to the UI thread.
   */
  async loadDataset(
    source: { kind: "file"; file: File } | { kind: "url"; url: string },
    options: Omit<LoadOptions, "onProgress">,
    onProgress?: (stage: string, done: number, total: number) => void,
  ): Promise<LoadedFile> {
    await ready;
    const report = onProgress
      ? (stage: string, done: number, total: number) => void onProgress(stage, done, total)
      : undefined;
    const opts: LoadOptions = { ...options, onProgress: report };
    const bruteForce = async (
      base: Float32Array,
      evalQueries: Float32Array,
      dim: number,
      l: number,
    ) => top_neighbors(base, evalQueries, dim, l, (done: number, total: number) =>
      report?.("computing ground truth", done, total),
    );

    return source.kind === "file"
      ? loadH5(source.file, opts, bruteForce)
      : loadRemoteH5(source.url, opts, bruteForce);
  },

  async run(config: string, data: Dataset): Promise<RunResponse> {
    await ready;
    return JSON.parse(
      run(config, data.base, data.eval, data.dim, data.candidates, data.candWidth),
    );
  },
};

export type RunnerApi = typeof api;

Comlink.expose(api);
