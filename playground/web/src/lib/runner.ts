// The UI's handle on the wasm worker. One worker for the page's lifetime.

import * as Comlink from "comlink";
import type { RunnerApi } from "./runner.worker";

let cached: Comlink.Remote<RunnerApi> | null = null;

export function runner(): Comlink.Remote<RunnerApi> {
  if (!cached) {
    const worker = new Worker(new URL("./runner.worker.ts", import.meta.url), {
      type: "module",
    });
    cached = Comlink.wrap<RunnerApi>(worker);
  }
  return cached;
}
