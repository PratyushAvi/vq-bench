#!/usr/bin/env python3
"""Write the Phase 0 fixture as an `.h5` in vq-bench's harness layout.

Lets the native CLI run on byte-identical vectors to the wasm harness, which is
what makes the parity check meaningful. Schema (read from
src/bin/vqb/dataset.rs, not guessed): base/eval float32, eval_candidates int64.
"""
import json
import pathlib
import sys
import h5py
import numpy as np

fixtures = pathlib.Path(__file__).parent / "fixtures"
meta = json.loads((fixtures / "meta.json").read_text())
dest = pathlib.Path(sys.argv[1])

read = lambda name, kind: np.fromfile(fixtures / name, dtype=kind)
base = read("base.f32", np.float32).reshape(meta["n_base"], meta["dim"])
evalq = read("eval.f32", np.float32).reshape(meta["n_eval"], meta["dim"])
cands = read("candidates.u32", np.uint32).reshape(meta["n_eval"], meta["cand_width"])

dest.parent.mkdir(parents=True, exist_ok=True)
with h5py.File(dest, "w") as f:
    f.create_dataset("base", data=base, dtype="f4")
    f.create_dataset("eval", data=evalq, dtype="f4")
    f.create_dataset("eval_candidates", data=cands.astype(np.int64), dtype="i8")
print(f"wrote {dest}  base={base.shape} eval={evalq.shape} cand={cands.shape}")
