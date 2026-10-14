// Loading the bundled sample dataset.
//
// Phase 1 ships one small dataset as raw typed-array files -- the same bytes
// tools/make_fixture.py writes, so the browser and the Phase 0 harness run on
// identical vectors. Phase 2 replaces this with real `.h5` parsing (h5wasm),
// which is why the return shape is the dataset itself and not a file handle.

import type { Dataset } from "./types";

/** One dataset importable straight from the VIBE repo. */
export type RemoteDataset = {
  name: string;
  dim: number;
  n_base: number | null;
};

type Registry = { base_url: string; datasets: RemoteDataset[] };

let registry: Promise<Registry> | null = null;

/**
 * The importable dataset list, generated from vq-bench's own registry by
 * tools/extract_sota.py so the two cannot drift.
 */
export function loadRegistry(): Promise<Registry> {
  registry ??= fetch("data/datasets.json").then((r) => {
    if (!r.ok) throw new Error(`could not load the dataset list (${r.status})`);
    return r.json() as Promise<Registry>;
  });
  return registry;
}

export function datasetUrl(base: string, name: string): string {
  return `${base}/${name}.hdf5`;
}

type Meta = {
  n_base: number;
  n_eval: number;
  dim: number;
  cand_width: number;
};

/** The sample dataset's human-facing description, for the UI. */
export const SAMPLE_DATASET = {
  name: "sample-128",
  describe: "1,000 clustered unit vectors in 128 dimensions, 50 queries",
};

async function fetchTyped<T>(
  url: string,
  Kind: new (buffer: ArrayBuffer) => T,
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load ${url} (${response.status})`);
  }
  return new Kind(await response.arrayBuffer());
}

export async function loadSampleDataset(): Promise<Dataset> {
  // Check the status before parsing. A host that answers a missing file with
  // an HTML error page -- an SPA fallback, or a CDN's own 404 -- would
  // otherwise surface as `JSON.parse: unexpected character`, which says
  // nothing about the file that is actually missing.
  const metaResponse = await fetch("data/meta.json");
  if (!metaResponse.ok) {
    throw new Error(`could not load data/meta.json (${metaResponse.status})`);
  }
  const meta: Meta = await metaResponse.json();
  const [base, evalQueries, candidates] = await Promise.all([
    fetchTyped("data/base.f32", Float32Array),
    fetchTyped("data/eval.f32", Float32Array),
    fetchTyped("data/candidates.u32", Uint32Array),
  ]);

  return {
    base,
    eval: evalQueries,
    candidates,
    dim: meta.dim,
    candWidth: meta.cand_width,
    nBase: meta.n_base,
    nEval: meta.n_eval,
  };
}
