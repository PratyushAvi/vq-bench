// The one list of things a run can be pointed at.
//
// Three sources look the same to the rest of the app: the bundled sample, a
// benchmark dataset read over byte ranges, and a file the user opened. Only
// `origin` distinguishes them, and only where it matters -- picking the right
// reference curve to overlay, and labelling a stored run.

import type { RemoteDataset } from "./dataset";
import type { Dataset } from "./types";

export type Source =
  | { kind: "sample" }
  | { kind: "benchmark"; remote: RemoteDataset }
  | { kind: "custom"; file: File };

/** One row of the dataset list. */
export type Entry = {
  /** Stable across reloads for sample and benchmark rows; per-file otherwise. */
  id: string;
  title: string;
  detail: string;
  source: Source;
  /** The benchmark dataset key, when this row corresponds to one. */
  benchmarkKey: string | null;
  /** Loaded vectors, once the row has been read. */
  dataset?: Dataset;
  /** What the file turned out to contain, for the UI to report. */
  summary?: string;
  /** Rows actually read, against the dataset's full size -- the difference
   *  between a subsampled score and a full-base one. */
  scale?: { sampled: number; total: number };
};

/** How far a dataset has got in the current run. */
export type Progress = {
  stage: string;
  done: number;
  total: number;
};

export function sampleEntry(nBase: number, nEval: number, dim: number): Entry {
  return {
    id: "sample",
    title: "random point set",
    detail: `${nBase.toLocaleString()} clustered unit vectors · ${dim}d · ${nEval} queries`,
    source: { kind: "sample" },
    benchmarkKey: null,
  };
}

export function benchmarkEntry(remote: RemoteDataset): Entry {
  const [short, ...rest] = remote.name.split("-");
  const detail = rest.filter((p) => p !== "normalized").join(" ");
  return {
    id: `benchmark:${remote.name}`,
    title: short,
    detail:
      `${detail} · ${remote.dim}d` +
      (remote.n_base === null ? "" : ` · ${remote.n_base.toLocaleString()} vectors`),
    source: { kind: "benchmark", remote },
    benchmarkKey: remote.name,
  };
}

export function customEntry(file: File): Entry {
  return {
    id: `custom:${file.name}:${file.size}`,
    title: file.name,
    detail: `${(file.size / 1048576).toFixed(0)} MB · from your device`,
    source: { kind: "custom", file },
    benchmarkKey: null,
  };
}
