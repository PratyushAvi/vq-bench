#!/usr/bin/env python3
"""Generate the Phase 0 parity fixture: a small, deterministic vector set.

Written as raw little-endian f32 plus a JSON sidecar, so the wasm harness and
the native CLI can both read exactly the same numbers. Real `.h5` loading is
Phase 2 work; this exists only to prove wasm and native agree.
"""
import json
import pathlib
import numpy as np

N_BASE, N_EVAL, DIM, CAND, SEED = 1000, 50, 128, 100, 1

out = pathlib.Path(__file__).parent / "fixtures"
out.mkdir(exist_ok=True)

rng = np.random.default_rng(SEED)
# Unit-norm clustered vectors: closer to real embeddings than pure uniform
# noise, so recall lands in an informative range instead of at chance.
centers = rng.normal(size=(10, DIM)).astype(np.float32)
base = (centers[rng.integers(0, 10, N_BASE)] + 0.5 * rng.normal(size=(N_BASE, DIM))).astype(np.float32)
evalq = (centers[rng.integers(0, 10, N_EVAL)] + 0.5 * rng.normal(size=(N_EVAL, DIM))).astype(np.float32)
base /= np.linalg.norm(base, axis=1, keepdims=True)
evalq /= np.linalg.norm(evalq, axis=1, keepdims=True)

# Each query's candidate pool = its true top-CAND by inner product, matching
# the single-stage assumption in vq-bench's metrics (candidates are the pool).
sims = evalq @ base.T
candidates = np.argsort(-sims, axis=1)[:, :CAND].astype(np.uint32)

(out / "base.f32").write_bytes(base.tobytes())
(out / "eval.f32").write_bytes(evalq.tobytes())
(out / "candidates.u32").write_bytes(candidates.tobytes())
(out / "meta.json").write_text(json.dumps(
    {"n_base": N_BASE, "n_eval": N_EVAL, "dim": DIM, "cand_width": CAND, "seed": SEED},
    indent=2) + "\n")
print(f"base {base.shape}  eval {evalq.shape}  candidates {candidates.shape}")
