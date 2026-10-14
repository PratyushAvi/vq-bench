# VQ-bench Playground

A fully in-browser, offline playground for [vq-bench](https://github.com/pinecone-io/vq-bench):
pick a quantizer, set its parameters, point it at vectors, and run it client-side.

All quantization behavior comes from vq-bench itself, compiled to WebAssembly. No
quantizer or metric logic is reimplemented in JavaScript.

**Status: Phase 2 complete, plus custom pipelines and a landing page.** vq-bench runs in WASM, its metrics
match the native `vqb` CLI on identical inputs, and the browser playground has a
live-validated config editor, loads your own `.h5` files, keeps a local run history, and
lets you compose your own quantizer from vq-bench's primitives.

## Layout

```
vendor/vq-bench/           our fork (branch `playground`, `upstream` remote set)
  src/metrics.rs           metrics, moved out of the CLI so a library user can call them
  crates/vqb-wasm/         the WASM wrapper -- the only Rust we maintain
tools/                     Phase 0 harness, wasm build, published-results extraction
web/                       the playground UI (Vite + React + Tailwind)
  src/lib/                 wasm worker, dataset + .h5 loading, run history
  src/components/          nav, landing, pickers, editor, charts, results, history
  test/smoke.mjs           drives the real UI in Chromium
```

## Getting the fork

`vendor/vq-bench` is not tracked by this repo yet — making it a submodule needs a fork
URL on your own account. Its two Phase 0 commits live in its own git history. To
recreate it from scratch:

```sh
git clone https://github.com/pinecone-io/vq-bench vendor/vq-bench
cd vendor/vq-bench && git remote rename origin upstream && git checkout -b playground
```

then re-apply the two changes described under [Fork changes](#fork-changes). Once you
have pushed your fork:

```sh
cd vendor/vq-bench && git remote add origin git@github.com:<you>/vq-bench.git && git push -u origin playground
cd ../.. && git submodule add git@github.com:<you>/vq-bench.git vendor/vq-bench
```

## Running the playground

```sh
cd web && npm install && npm run dev
```

`web/src/wasm/` and `web/public/data/` are **committed**, so a fresh clone runs and
builds with only Node — no Rust toolchain, no fork. That is what lets a static host
build the site from this repo alone.

The cost is that the binary can drift from the crate it was built from: after any
change to `vendor/vq-bench`, re-run

```sh
./tools/build_wasm.sh          # wasm module + sample dataset into web/
```

and commit the result, or the app keeps running the previous build. Making the fork
a submodule and building in CI is the better long-term answer.

### Using it

Open the URL `npm run dev` prints. Pick a quantizer, adjust its params, press Run. A
comma-separated numeric param sweeps, so `b` of `2, 4, 6` runs three quantizers and
returns three rows. The JSON editor is dry-run against vq-bench as you type, so an
invalid param is flagged before you run anything.

Drop in your own `.h5` to run against it. Two layouts are accepted:

| | base vectors | queries | ground truth |
|---|---|---|---|
| harness (what `vqb data get` writes) | `base` | `eval` | `eval_candidates` |
| VIBE (what you download) | `train` | `test` | `neighbors` |

Rows are currently read as one contiguous chunk from a seeded random offset. That is a
single hyperslab, so an import is one range request rather than ~120, and finishes in
about a second instead of a minute — a deliberate trade of representativeness for a
responsive interface while the UI is being built. A dataset ordered by class or ingestion
date will hand back a biased slice; restoring a spread sample means drawing several runs
instead of one (`sampleIndices` in `web/src/lib/h5.ts`). When a
file ships no ground truth -- or when subsampling makes its indices meaningless -- the
exact top-L is brute-forced by vq-bench through the WASM boundary, never in JS.

Runs are kept in IndexedDB on your device: the config, the scores, and how long it took.
Never the vectors, and never the file.

### Importing a benchmark dataset

The ten VIBE datasets can be imported straight from the playground — no upload, and no
download either. They run from 350 MB to 34 GB, far past what a browser can hold, so they
are read over HTTP byte ranges: HDF5 asks for the chunks covering the rows you sampled and
nothing else. Importing 2,000 rows of the 350 MB `llama` set transfers about 0.1 MB in ~130
requests.

Datasets must be imported before they can be selected, and several can run at once — each
shows its own progress bar and gets its own results panel, so a number is never ambiguous
about which vectors produced it. Your own `.h5` joins the same list (a local file has no
range endpoint, so that one is still read whole, and warns past 500 MB).

### Comparing against the benchmark

The landing page plots the five strongest quantizer families from the published vq-bench
results, and the playground overlays your own run on the same axes — recall@10 against
bits per dimension, where up and to the left is better.

Those curves come from `tools/extract_sota.py`, which distills the fork's own
`docs/results/aug-2026.json` (the file behind the table on vq-bench.com) down to ~30 KB.
It is bundled as a static asset, so the comparison works offline like everything else.
Re-run it after syncing the fork to pick up a newer benchmark run.

Every results panel has a **chart** and a **table** view. The chart carries only numbers
measured on the same vectors: this run, and earlier runs on the same dataset (merged into
one curve per family, so a sweep explored one run at a time still reads as a curve).

The published figures are *not* drawn on the chart, because they were measured over each
dataset's full base and your run is a subsample — a smaller base is an easier search, so
plotting them together would flatter your numbers. Instead:

- the table cites each method's published figure as a byline, and marks every row with the
  vectors it actually scored (`2k sample` against `257k full`);
- one button runs **all fifteen registered vq-bench quantizers on your own sub-sample**,
  which is the apples-to-apples comparison — same vectors, same ground truth, one ranking.

Ranks are global and every column sorts, so you can compare at a fixed bit rate rather
than letting the bit budget decide the order. Both views remember their settings.

### Running many quantizers at once

Methods are a checkbox list — several built-in families, plus any pipeline you have saved,
run together in one pass so a frontier can be filled in *en masse* rather than one method
at a time. `all` / `none` make bulk selection cheap. A composed pipeline can be named and
saved; it then appears in its own **Saved** section alongside the built-ins.

### Composing your own quantizer

The **Compose** tab chains vq-bench's primitives into a pipeline of your own — no
recompile, and it runs offline like everything else:

```json
{ "name": "my-quantizer", "stages": [
    { "name": "center" },
    { "name": "normalize" },
    { "name": "random_hadamard" },
    { "name": "cast_angular", "b": 4 }
] }
```

That chain *is* `e_rabitq`, and it reproduces it exactly — same recall, same MSE. So do
`minmax`, `rabitq` and `itq_asym` when composed from their documented stages, which is the
check that the builder really runs vq-bench's primitives rather than approximating them.

Every seeded stage takes the run's seed by default; give a stage its own `seed` when a
chain needs two *different* random rotations. Stage params, and each stage's compatibility
with the one before it, are validated by vq-bench through `Pipeline::new`.

Only linear chains are composable. Splitters (`SegmentSplit`) fan out into branch
pipelines, which a linear chain cannot express — PQ and OPQ remain available as built-in
families.

Note that vq-bench checks *dimensions*, not sensibility: a chain with no rounder, or with
two, will run. The builder warns about the first rather than blocking it.

In VS Code, `Cmd+Shift+P` → **Simple Browser: Show** → `http://localhost:5173` renders the
app in an editor tab beside the code, hot reload included; no extension needed. The
**web: dev + preview** task starts the server first. For breakpoints instead, use the
**Playground (preview + devtools)** launch configuration.

To check the UI end to end (needs `npm run dev` in another terminal):

```sh
cd web && npm run smoke
```

It drives Chromium and asserts, among other things, that the browser's recall matches
the values Phase 0 pinned against the native CLI.

## Verifying Phase 0

```sh
./tools/verify_phase0.sh
```

Builds the WASM module, runs it headlessly, runs the native CLI on the same vectors,
and compares every metric. Requires `wasm-pack`, the `wasm32-unknown-unknown` Rust
target, Node, `python3` with numpy+h5py, and system HDF5 (for the native CLI only --
the WASM build needs none of it).

Individual pieces:

```sh
python3 tools/make_fixture.py         # deterministic 1000 x 128 vectors
node tools/run_wasm.mjs               # run the default config through WASM
node tools/run_wasm.mjs '{"methods":[{"name":"e_rabitq","b":[2,4]}],"metrics":["recall"]}'
```

## The WASM API

Four exported functions, kept deliberately small so UI work rarely needs a Rust rebuild:

| function | purpose |
|---|---|
| `list_quantizers()` | every family, from the live registry (15 today) |
| `list_metrics()` | every metric this build reports (9) |
| `validate_config(json, dim)` | the dry run: names, params, values -- computes nothing |
| `run(json, base, eval, dim, candidates, cand_width)` | fit, encode, score, reconstruct |
| `top_neighbors(base, eval, dim, l, on_progress)` | exact top-L ground truth, with progress |
| `list_primitives()` | the composable stages (19 today) |

Config JSON matches the CLI's, minus `datasets` (the browser passes vectors directly).
An array-valued param sweeps, as upstream: `{"name": "minmax", "b": [2, 4, 6]}` is three runs.

## Fork changes

Kept minimal and additive so rebasing onto upstream stays cheap:

1. **`src/bin/vqb/bench.rs` → `src/metrics.rs`**, exported as `pub mod metrics`. The metric
   math was trapped inside the CLI binary. It depends only on `std` + `rand`, so it moved
   as-is; the CLI aliases it back as `crate::bench` and every call site is unchanged.
2. **`TopL` / `tile_rows` → `src/candidates.rs`**, exported as `pub mod candidates` with a
   `top_neighbors_with_progress` entry point. Exact top-L search was CLI-only, so a browser
   had no way to build ground truth for a file that ships none.
3. **`src/primitives/registry.rs`**, exported as `pub mod registry`. The primitive catalog
   reports what exists but not how to *make* one, so a pipeline could not be built from
   config. This adds a key → constructor row per stage, mirroring `QuantizerSpec`.
4. **faer without its `rayon` feature.** That feature pulls `spindle` → `atomic-wait`, which
   has no `wasm32-unknown-unknown` backend. All other faer defaults are kept, so native
   builds are unaffected.

Syncing upstream:

```sh
cd vendor/vq-bench && git fetch upstream && git rebase upstream/main
```

New quantizers and metrics then appear in the playground automatically, since both lists
are read from the registry rather than hardcoded.

## Notes for the next phase

- **Threading is off.** v1 is single-threaded. Worth knowing: the native CLI already calls
  `faer::set_global_parallelism(Par::Seq)`, so threads would speed up chunked *encoding*,
  not the linear algebra.
- **ITQ and OPQ differ slightly from native** (recall within ~0.03). Both run iterative
  SVD/eigen solves and then iterate on the result; x86-64 and wasm32 round differently, so
  they settle on different local optima. The gap is smaller than each method's own
  seed-to-seed spread — on native, ITQ moves 0.250/0.274/0.254 across seeds 1/2/3 while
  MinMax stays flat at 0.694. `tools/compare_parity.mjs` encodes this as a wider tolerance
  for those two families and holds every other method to near-exact agreement.
- **The UI's param table is a rendering hint, not a rule.** `web/src/lib/params.ts` maps
  param names to input types, because the registry reports names but not types. Every
  value is still checked by `validate_config` (which calls the quantizer's own `build`),
  so a wrong hint surfaces as a real error from vq-bench rather than a bad run. An
  unlisted param falls back to a text field and still works.
- **A `.h5` must fit in the WASM address space.** h5wasm needs the whole file resident
  before it can read any of it (HDF5 wants random access; the browser's only filesystem is
  in-memory), and `wasm32` addresses at most 4 GB regardless of how much RAM the machine
  has. Roughly: ~300 MB is comfortable, ~1 GB is slow, ~3 GB will not work. The UI warns
  past 500 MB. Lifting this needs a lazy range-request reader, `wasm64`, or the Phase 6
  Tauri build -- not a Phase 2 change.
- **h5wasm is ~4.8 MB** against our own 813 KB module, so it is lazy-loaded on first file
  open and never touches the default page load.
