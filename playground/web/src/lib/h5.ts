// Reading a user's own `.h5` in the browser.
//
// Two schemas exist in the wild and this accepts both:
//
//   harness  base / eval / eval_candidates / calib   -- what `vqb data get` writes
//   VIBE     train / test / neighbors / learn        -- what you download from VIBE
//
// Only deserialization happens here. Ground truth, when a file ships none, is
// brute-forced by vq-bench through the wasm boundary -- never in JS.

import type { Dataset } from "./types";

/** How a file's arrays are named. */
type Schema = {
  base: string;
  eval: string;
  candidates: string | null;
};

const SCHEMAS: Schema[] = [
  { base: "base", eval: "eval", candidates: "eval_candidates" },
  { base: "train", eval: "test", candidates: "neighbors" },
];

export type LoadOptions = {
  /** Base rows to sample. */
  nBase: number;
  /** Eval queries to sample. */
  nEval: number;
  /** Candidate pool width, used only when the file ships no ground truth. */
  candWidth: number;
  /** Seeds the row sample, so the same file and settings give the same subset. */
  seed: number;
  onProgress?: (stage: string, done: number, total: number) => void;
};

/**
 * h5wasm is ~4 MB -- an order of magnitude more than our own module -- so it is
 * fetched only when someone actually opens a file, not on page load.
 */
let h5Module: Promise<typeof import("h5wasm")> | null = null;
function h5wasm(): Promise<typeof import("h5wasm")> {
  h5Module ??= import("h5wasm").then(async (mod) => {
    await mod.ready;
    return mod;
  });
  return h5Module;
}

/** Mulberry32: a small seeded PRNG, so a sampled subset is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` row indices from `0..total`, ascending.
 *
 * Currently one contiguous chunk from a seeded random offset. That is a single
 * hyperslab, so a remote import costs one range request rather than the ~120 a
 * scattered sample needs, and finishes in about a second instead of a minute.
 * The cost is representativeness: a dataset ordered by class or ingestion date
 * hands back a biased slice. A deliberate trade for a responsive interface, not
 * a statistically sound sample -- restoring a spread sample means drawing
 * several runs instead of one, and `readRows` already coalesces whatever it is
 * handed.
 */
function sampleIndices(total: number, count: number, random: () => number): number[] {
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  // Seeded offset, so the same dataset and settings still give the same rows.
  const start = Math.floor(random() * (total - count));
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Read the given rows of a 2-D dataset into one contiguous Float32Array.
 *
 * `onRow` is called as blocks land. That matters more than it looks: against a
 * remote file each block is an HTTP range request, so a large sample can take
 * minutes, and a bar that only moved at the end would read as a hang.
 */
function readRows(
  dataset: any,
  rows: number[],
  dim: number,
  onRow?: (done: number) => void,
): Float32Array {
  const out = new Float32Array(rows.length * dim);
  // Contiguous runs read in one hyperslab; scattered rows cost a call each,
  // which measures ~5x slower but is still well under a second locally.
  let i = 0;
  while (i < rows.length) {
    let run = 1;
    while (i + run < rows.length && rows[i + run] === rows[i] + run) run += 1;
    const block = dataset.slice([[rows[i], rows[i] + run], [0, dim]]) as Float32Array;
    out.set(block, i * dim);
    i += run;
    onRow?.(i);
  }
  return out;
}

export type LoadedFile = {
  dataset: Dataset;
  /** What the file actually contained, for the UI to report. */
  summary: {
    schema: "harness" | "vibe";
    fileBase: number;
    fileEval: number;
    dim: number;
    sampledBase: number;
    sampledEval: number;
    groundTruth: "from file" | "brute-forced";
  };
};

/**
 * Parse `file` and return a sampled dataset ready to run.
 *
 * `bruteForce` computes exact top-L when the file ships no neighbors; it is
 * passed in rather than imported so this module stays free of the wasm runner.
 */
export type BruteForce = (
  base: Float32Array,
  evalQueries: Float32Array,
  dim: number,
  l: number,
) => Promise<Uint32Array>;

/** Read a file the user picked. The bytes must all be resident -- see below. */
export async function loadH5(
  file: File,
  options: LoadOptions,
  bruteForce: BruteForce,
): Promise<LoadedFile> {
  const mod = await h5wasm();
  // h5wasm types FS as nullable because it is only populated once `ready`
  // resolves, which it has by the time h5wasm() returns.
  const FS = mod.FS!;
  options.onProgress?.("reading file", 0, 1);

  // A local File has no byte-range endpoint, so HDF5's random access means the
  // whole thing must be in memory. wasm32 addresses at most 4 GB, so this is
  // where the size ceiling on uploads comes from -- remote imports below avoid
  // it entirely by fetching only the ranges HDF5 asks for.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scratch = `upload-${Date.now()}.h5`;
  FS.writeFile(scratch, bytes);
  options.onProgress?.("reading file", 1, 1);

  return readMounted(scratch, options, bruteForce, () => {
    try {
      FS.unlink(scratch);
    } catch {
      // Best effort: the in-memory file goes away with the page anyway.
    }
  });
}

/**
 * Import a dataset straight from its URL, without downloading it whole.
 *
 * `createLazyFile` backs the file with byte-range requests, so HDF5 pulls only
 * the chunks it actually reads. Sampling a few thousand rows out of a multi-GB
 * dataset therefore transfers megabytes, not gigabytes -- which is what makes
 * the larger VIBE datasets usable in a browser at all.
 *
 * The reads are synchronous XHR under the hood: fine in a worker, blocked on
 * the main thread, so this must not be called from the UI thread.
 */
export async function loadRemoteH5(
  url: string,
  options: LoadOptions,
  bruteForce: BruteForce,
): Promise<LoadedFile> {
  const mod = await h5wasm();
  const FS = mod.FS!;
  options.onProgress?.("opening remote file", 0, 1);

  const name = `remote-${Date.now()}.h5`;
  // (parent, name, url, canRead, canWrite) -- the file is read-only and its
  // contents are never held in full.
  FS.createLazyFile("/", name, url, true, false);
  options.onProgress?.("opening remote file", 1, 1);

  return readMounted(name, options, bruteForce, () => {
    try {
      FS.unlink(name);
    } catch {
      // Best effort.
    }
  });
}

/** Everything after the bytes are reachable, shared by both sources. */
async function readMounted(
  path: string,
  options: LoadOptions,
  bruteForce: BruteForce,
  cleanup: () => void,
): Promise<LoadedFile> {
  const mod = await h5wasm();
  const H5File = mod.File;
  const handle = new H5File(path, "r");
  try {
    const keys = handle.keys();
    const schema = SCHEMAS.find((s) => keys.includes(s.base) && keys.includes(s.eval));
    if (!schema) {
      throw new Error(
        `unrecognized layout: found [${keys.join(", ")}], expected either ` +
          `base/eval (harness) or train/test (VIBE)`,
      );
    }

    const baseSet = handle.get(schema.base) as any;
    const evalSet = handle.get(schema.eval) as any;
    const [fileBase, dim] = baseSet.shape as [number, number];
    const [fileEval, evalDim] = evalSet.shape as [number, number];
    if (dim !== evalDim) {
      throw new Error(`${schema.base} is ${dim}-dim but ${schema.eval} is ${evalDim}-dim`);
    }

    const random = seededRandom(options.seed);
    const baseRows = sampleIndices(fileBase, options.nBase, random);
    const evalRows = sampleIndices(fileEval, options.nEval, random);

    const stage = "downloading dataset sample";
    options.onProgress?.(stage, 0, baseRows.length + evalRows.length);
    const base = readRows(baseSet, baseRows, dim, (done) =>
      options.onProgress?.(stage, done, baseRows.length + evalRows.length),
    );
    const evalQueries = readRows(evalSet, evalRows, dim, (done) =>
      options.onProgress?.(stage, baseRows.length + done, baseRows.length + evalRows.length),
    );

    // Shipped neighbors index the *full* base, so they cannot be reused once we
    // subsample -- the indices would point at rows we did not keep. Recompute
    // over the sample instead, which is what the CLI does for a subsampled DB.
    const subsampled = baseRows.length < fileBase;
    const hasNeighbors = schema.candidates !== null && keys.includes(schema.candidates);
    let candidates: Uint32Array;
    let candWidth: number;
    let groundTruth: "from file" | "brute-forced";

    if (hasNeighbors && !subsampled) {
      const set = handle.get(schema.candidates!) as any;
      const width = (set.shape as [number, number])[1];
      const raw = set.value as ArrayLike<number | bigint>;
      candidates = new Uint32Array(evalRows.length * width);
      evalRows.forEach((row, k) => {
        for (let c = 0; c < width; c += 1) {
          candidates[k * width + c] = Number(raw[row * width + c]);
        }
      });
      candWidth = width;
      groundTruth = "from file";
    } else {
      options.onProgress?.("computing ground truth", 0, baseRows.length);
      candWidth = Math.min(options.candWidth, baseRows.length);
      candidates = await bruteForce(base, evalQueries, dim, candWidth);
      groundTruth = "brute-forced";
    }

    return {
      dataset: {
        base,
        eval: evalQueries,
        candidates,
        dim,
        candWidth,
        nBase: baseRows.length,
        nEval: evalRows.length,
      },
      summary: {
        schema: schema.base === "base" ? "harness" : "vibe",
        fileBase,
        fileEval,
        dim,
        sampledBase: baseRows.length,
        sampledEval: evalRows.length,
        groundTruth,
      },
    };
  } finally {
    handle.close();
    cleanup();
  }
}
