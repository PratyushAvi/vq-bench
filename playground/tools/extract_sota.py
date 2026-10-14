#!/usr/bin/env python3
"""Extract the published vq-bench results into a small file the web app bundles.

The full results JSON is ~900 KB of every metric for 59 methods across 10
datasets. The playground needs one curve per family -- recall@10 against bits
per dimension -- so this keeps that and drops the rest.

Source: vendor/vq-bench/docs/results/aug-2026.json, the same file behind the
table on vq-bench.com. Regenerate after syncing the fork with upstream.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/vq-bench/docs/results/aug-2026.json"
DEST = ROOT / "web/public/data/sota.json"
REGISTRY_SOURCE = ROOT / "vendor/vq-bench/src/bin/vqb/registry.rs"
REGISTRY_DEST = ROOT / "web/public/data/datasets.json"

# The five strongest families by mean recall@10 near 4 bits/dim, measured over
# all ten datasets. EDEN-prod is omitted: it tracks EDEN-MSE to within 0.0001,
# so plotting both would draw one curve twice.
FAMILIES = ["OPQ", "PQ", "EDEN-MSE", "E-RaBitQ", "TurboQuant-MSE"]

results = json.loads(SOURCE.read_text())
meta = results["meta"]

datasets = {}
for entry in results["datasets"]:
    curves = {}
    for method in entry["methods"]:
        family = method["label"].split(" (")[0]
        if family not in FAMILIES:
            continue
        recall = method.get("recalls", {}).get("10")
        if recall is None:
            continue
        curves.setdefault(family, []).append(
            {
                "label": method["label"],
                "bits": round(method["bits_per_dim"], 4),
                "recall": round(recall, 5),
                "mse_recon": round(method.get("mse_recon", 0.0), 8),
            }
        )
    for points in curves.values():
        points.sort(key=lambda p: p["bits"])
    datasets[entry["dataset"]] = {
        "dim": entry["dim"],
        "n_base": entry["n_base"],
        "curves": curves,
    }

DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(
    json.dumps(
        {
            "source": "vq-bench.com/results/aug-2026.json",
            "run": meta["name"],
            "generated": meta["timestamp"],
            "k": 10,
            "families": FAMILIES,
            "datasets": datasets,
        },
        indent=1,
    )
    + "\n"
)
# The importable dataset list, read out of the crate's own registry so the two
# cannot drift. Sizes are not recorded: they are a property of the remote file,
# and the loader reads them from a HEAD request at import time.
import re

rows = re.findall(
    r'name:\s*"([^"]+)",\s*\n\s*dim:\s*(\d+)', REGISTRY_SOURCE.read_text()
)
REGISTRY_DEST.write_text(
    json.dumps(
        {
            "base_url": "https://huggingface.co/datasets/vector-index-bench/vibe/resolve/main",
            "datasets": [
                {
                    "name": name,
                    "dim": int(dim),
                    "n_base": datasets.get(name, {}).get("n_base"),
                }
                for name, dim in rows
            ],
        },
        indent=1,
    )
    + "\n"
)

print(f"{DEST.relative_to(ROOT)}  {DEST.stat().st_size / 1024:.0f} KB")
print(f"{REGISTRY_DEST.relative_to(ROOT)}  {len(rows)} datasets")
for name, entry in datasets.items():
    counts = ", ".join(f"{f}:{len(p)}" for f, p in entry["curves"].items())
    print(f"  {name:36} {counts}")
