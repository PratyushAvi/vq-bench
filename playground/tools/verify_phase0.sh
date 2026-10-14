#!/usr/bin/env bash
# Phase 0 acceptance check, end to end: build the wasm module, run it headless,
# run the native CLI on the same vectors, and compare.
#
# Needs: rustup with the wasm32-unknown-unknown target, wasm-pack, node, python3
# with numpy+h5py, and system hdf5 (native CLI only).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fork="$root/vendor/vq-bench"
cd "$root"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "fixture"
python3 tools/make_fixture.py

step "wasm build"
# getrandom 0.3+ needs this cfg to pick its browser backend.
( cd "$fork/crates/vqb-wasm" \
  && RUSTFLAGS='--cfg getrandom_backend="wasm_js"' \
     wasm-pack build --target nodejs --out-dir pkg 2>&1 | tail -3 )

step "wasm run (headless)"
node tools/run_wasm.mjs

step "native parity"
if command -v h5cc >/dev/null 2>&1 || [ -d /usr/local/opt/hdf5 ] || [ -d /opt/homebrew/opt/hdf5 ]; then
  # The CLI resolves datasets by registry name, so the fixture is written to the
  # path of a same-dimension entry (llama-128-ip is 128-dim, as is the fixture).
  python3 tools/fixture_to_h5.py "$fork/data/llama-128-ip.hdf5"
  HDF5_DIR="${HDF5_DIR:-$( [ -d /opt/homebrew/opt/hdf5 ] && echo /opt/homebrew/opt/hdf5 || echo /usr/local/opt/hdf5 )}" \
    cargo build --release --bin vqb --manifest-path "$fork/Cargo.toml" 2>&1 | tail -2
  ( cd "$fork" && ./target/release/vqb run "$root/tools/parity.json" 2>&1 | tail -12 )
  node tools/compare_parity.mjs "$fork/results/parity.json" tools/parity.json
else
  echo "skipped: no system hdf5, so the native CLI cannot be built" >&2
fi
