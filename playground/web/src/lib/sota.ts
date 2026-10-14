// The published vq-bench results, as the playground's reference curves.
//
// Extracted by tools/extract_sota.py from the fork's own
// docs/results/aug-2026.json -- the same file behind the table on vq-bench.com
// -- so the app needs no network to show them.

export type SotaPoint = {
  label: string;
  bits: number;
  recall: number;
  mse_recon: number;
};

export type SotaDataset = {
  dim: number;
  n_base: number;
  curves: Record<string, SotaPoint[]>;
};

export type Sota = {
  source: string;
  run: string;
  generated: number;
  k: number;
  families: string[];
  datasets: Record<string, SotaDataset>;
};

let cached: Promise<Sota> | null = null;

export function loadSota(): Promise<Sota> {
  cached ??= fetch("data/sota.json").then((r) => {
    if (!r.ok) throw new Error(`could not load reference results (${r.status})`);
    return r.json() as Promise<Sota>;
  });
  return cached;
}

/** A readable dataset name: `arxiv-nomic-768-normalized` -> `arxiv (768d)`. */
export function shortName(key: string, dim: number): string {
  return `${key.split("-")[0]} (${dim}d)`;
}
