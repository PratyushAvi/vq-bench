// A small pool of workers dedicated to reading datasets.
//
// Imports cannot share the single run worker. A remote read spends its whole
// life inside `FS.createLazyFile`, whose byte-range fetches are synchronous
// XHR -- that blocks the worker's event loop outright, so a second import
// message is not merely slow to start, it cannot be dequeued at all until the
// first finishes. Every click during a download therefore looked ignored.
//
// Each import gets its own short-lived worker instead, so downloads overlap.
// The pool is bounded because the datasets share one origin: past a handful of
// sockets the browser queues the requests anyway, and each worker pays for its
// own ~4 MB copy of h5wasm.

import * as Comlink from "comlink";

import type { RunnerApi } from "./runner.worker";

/** Concurrent imports. Beyond this, waiting is the browser's own doing. */
const MAX_PARALLEL = 3;

type Job<T> = {
  run: (api: Comlink.Remote<RunnerApi>) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const waiting: Job<never>[] = [];
let active = 0;

/**
 * Run `job` on a worker of its own, once one is free.
 *
 * Resolves with the job's value; rejects with whatever it threw, so callers
 * handle failure exactly as they did when the call went straight to `runner()`.
 */
export function withLoader<T>(run: (api: Comlink.Remote<RunnerApi>) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({ run, resolve, reject } as unknown as Job<never>);
    pump();
  });
}

/** True while an import holds a worker, or is queued behind one. */
export function loaderBusy(): boolean {
  return active > 0 || waiting.length > 0;
}

function pump(): void {
  while (active < MAX_PARALLEL && waiting.length > 0) {
    const job = waiting.shift()!;
    active += 1;
    void spawn(job);
  }
}

async function spawn(job: Job<never>): Promise<void> {
  const worker = new Worker(new URL("./runner.worker.ts", import.meta.url), {
    type: "module",
  });
  const api = Comlink.wrap<RunnerApi>(worker);
  try {
    job.resolve(await job.run(api));
  } catch (err: unknown) {
    job.reject(err);
  } finally {
    // The worker held a whole dataset and a copy of h5wasm; it has no further
    // use once the vectors are back on the main thread.
    worker.terminate();
    active -= 1;
    pump();
  }
}
