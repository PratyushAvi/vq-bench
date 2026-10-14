#!/usr/bin/env python3
"""Generate the `.h5` fixtures the browser smoke test loads.

Deterministic, so they are generated rather than tracked. Covers the two
layouts the loader accepts plus a file matching neither, which is what proves
the error path reports something useful.
"""
import pathlib
import h5py
import numpy as np

out = pathlib.Path(__file__).parent
rng = np.random.default_rng(7)


def unit_vectors(n, d):
    v = rng.normal(size=(n, d)).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


# Harness layout, ground truth included -- the `vqb data get` output shape.
base, queries = unit_vectors(2000, 64), unit_vectors(40, 64)
neighbors = np.argsort(-(queries @ base.T), axis=1)[:, :50].astype(np.int64)
with h5py.File(out / "harness.h5", "w") as f:
    f.create_dataset("base", data=base, dtype="f4")
    f.create_dataset("eval", data=queries, dtype="f4")
    f.create_dataset("eval_candidates", data=neighbors, dtype="i8")

# Raw VIBE layout with no neighbors, so loading it must brute-force the truth.
with h5py.File(out / "vibe_no_neighbors.h5", "w") as f:
    f.create_dataset("train", data=unit_vectors(1500, 32), dtype="f4")
    f.create_dataset("test", data=unit_vectors(25, 32), dtype="f4")

# Neither layout: the loader should say so, naming what it found.
with h5py.File(out / "wrong.h5", "w") as f:
    f.create_dataset("something_else", data=np.zeros((3, 3), dtype="f4"))

for path in sorted(out.glob("*.h5")):
    with h5py.File(path) as f:
        print(f"{path.name:24} {list(f.keys())}")
