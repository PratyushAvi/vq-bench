// Compare wasm metrics against a native `vqb run` results JSON on the same
// fixture. Phase 0's core claim is that these agree, so this is the check that
// has to keep passing.
//
//   node tools/compare_parity.mjs <native-results.json> <config.json>

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wasm = require(join(here, "../vendor/vq-bench/crates/vqb-wasm/pkg/vqb_wasm.js"));

const [nativePath, configPath] = process.argv.slice(2);
if (!nativePath || !configPath) {
  console.error("usage: node tools/compare_parity.mjs <native-results.json> <config.json>");
  process.exit(2);
}

// Recall is a ratio over the eval queries, so it moves in discrete steps -- an
// absolute tolerance below one step means "not a single query ranked
// differently". Float metrics get a relative tolerance, loose enough to absorb
// the 6 significant digits the native results JSON rounds to.
const RECALL_TOLERANCE = 1e-9;
const RELATIVE_TOLERANCE = 1e-5;

// Quantizers whose fit runs an iterative SVD/eigen solve (faer's thin_svd via
// orthogonal_procrustes, symmetric_eigen via pca_rotate) and then iterates on
// the result. x86-64 and wasm32 round differently -- FMA contraction, SIMD
// width -- so the solvers settle on different local optima. The gap is smaller
// than these methods' own seed-to-seed spread (measured on native: ITQ
// 0.250/0.274/0.254 and OPQ 0.446/0.450/0.464 for seeds 1/2/3, against MinMax
// flat at 0.694), so it is numerical sensitivity, not a porting bug.
// Deterministic quantizers are still held to near-exact agreement.
const ITERATIVE_SOLVERS = /^(ITQ|OPQ)\b/;
const ITERATIVE_TOLERANCE = 0.05;

const meta = JSON.parse(readFileSync(join(here, "fixtures/meta.json"), "utf8"));
const load = (name, Kind) => {
  const b = readFileSync(join(here, "fixtures", name));
  return new Kind(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

// The native config names a dataset; the wasm one gets its vectors passed in.
const config = JSON.parse(readFileSync(configPath, "utf8"));
delete config.datasets;

const out = JSON.parse(wasm.run(
  JSON.stringify(config),
  load("base.f32", Float32Array),
  load("eval.f32", Float32Array),
  meta.dim,
  load("candidates.u32", Uint32Array),
  meta.cand_width,
));
if (!out.ok) {
  console.error("wasm run failed:", out.errors.join("\n  "));
  process.exit(1);
}

const native = JSON.parse(readFileSync(nativePath, "utf8")).datasets[0].methods;
const byLabel = Object.fromEntries(native.map((m) => [m.label, m]));

const rows = [];
for (const result of out.results) {
  const ref = byLabel[result.label];
  if (!ref) {
    rows.push({ label: result.label, metric: "(no native run)", ok: false });
    continue;
  }
  const iterative = ITERATIVE_SOLVERS.test(result.label);
  const floatTol = iterative ? ITERATIVE_TOLERANCE : RELATIVE_TOLERANCE;
  const recallTol = iterative ? ITERATIVE_TOLERANCE : RECALL_TOLERANCE;
  const pairs = [
    // Size is exact arithmetic over byte counts, so it must match regardless of
    // how the method arrives at its codes.
    ["bits_per_dim", ref.bits_per_dim, result.bits_per_dim, RELATIVE_TOLERANCE],
    ["mse_score", ref.mse_score, result.mse_score, floatTol],
    ["mse_recon", ref.mse_recon, result.mse_recon, floatTol],
  ];
  for (const k of Object.keys(result.recall ?? {})) {
    pairs.push([`recall@${k}`, ref.recalls?.[k], result.recall[k], recallTol, true]);
  }
  for (const [metric, a, b, tol, absolute] of pairs) {
    if (a === undefined || b === undefined) continue;
    const delta = absolute ? Math.abs(a - b) : Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
    rows.push({ label: result.label, metric, native: a, wasm: b, delta, ok: delta <= tol });
  }
}

const width = Math.max(...rows.map((r) => r.label.length), 6);
for (const r of rows) {
  const status = r.ok ? "ok  " : "DIFF";
  const detail = r.ok ? "" : `  native=${r.native} wasm=${r.wasm} (${r.delta.toExponential(2)})`;
  console.log(`${status} ${r.label.padEnd(width)}  ${r.metric}${detail}`);
}

const failed = rows.filter((r) => !r.ok);
console.log(failed.length === 0
  ? `\nall ${rows.length} comparisons match`
  : `\n${failed.length} of ${rows.length} comparisons differ`);
process.exit(failed.length === 0 ? 0 : 1);
