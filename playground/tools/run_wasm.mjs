// Phase 0 headless harness: run a config through the wasm module and print the
// metrics. This is the browser's exact code path, minus the browser.
//
//   node tools/run_wasm.mjs '{"methods":[{"name":"minmax","b":[4]}]}'

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wasm = require(join(here, "../vendor/vq-bench/crates/vqb-wasm/pkg/vqb_wasm.js"));

const fixtures = join(here, "fixtures");
const meta = JSON.parse(readFileSync(join(fixtures, "meta.json"), "utf8"));

/** Read a raw little-endian typed-array file written by make_fixture.py. */
const load = (name, Kind) => {
  const bytes = readFileSync(join(fixtures, name));
  // Copy through .slice() so the array is aligned and owns its buffer.
  return new Kind(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

const base = load("base.f32", Float32Array);
const evalQ = load("eval.f32", Float32Array);
const candidates = load("candidates.u32", Uint32Array);

const config = process.argv[2] ?? JSON.stringify({
  methods: [{ name: "minmax", b: [4] }],
  metrics: ["recall", "mse_score", "mse_recon"],
  k: [10],
  seed: meta.seed,
});

const check = JSON.parse(wasm.validate_config(config, meta.dim));
if (!check.ok) {
  console.error("invalid config:", check.errors.join("\n  "));
  process.exit(1);
}

const started = performance.now();
const out = JSON.parse(
  wasm.run(config, base, evalQ, meta.dim, candidates, meta.cand_width),
);
const elapsed = ((performance.now() - started) / 1000).toFixed(2);

if (!out.ok) {
  console.error("run failed:", out.errors.join("\n  "));
  process.exit(1);
}

console.log(`${meta.n_base} x ${meta.dim} base, ${meta.n_eval} queries, ${elapsed}s\n`);
for (const r of out.results) {
  console.log(r.label);
  for (const [name, value] of Object.entries(r)) {
    if (name === "label") continue;
    console.log(`  ${name.padEnd(12)} ${JSON.stringify(value)}`);
  }
}
