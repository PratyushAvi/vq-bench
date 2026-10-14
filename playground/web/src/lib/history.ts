// Local run history.
//
// IndexedDB rather than cookies or localStorage: results run to tens of KB per
// run, cookies cap at ~4 KB and would be sent on every request (there is no
// server to send them to), and localStorage is synchronous and ~5 MB. This is
// also the storage Phase 3's run history builds on, so it is worth doing
// properly now.
//
// Everything stays on the device. No run ever leaves the browser.

import type { MethodResult } from "./types";

const DB_NAME = "vq-playground";
const STORE = "runs";
const PREFS = "prefs";
const SAVED = "quantizers";
const DB_VERSION = 3;

/** One completed run, as stored. */
export type RunRecord = {
  /** Milliseconds since the epoch; also the primary key. */
  id: number;
  /** The config that produced it, so a run can be re-read or re-run. */
  config: string;
  /** Which dataset it ran against, as shown in the UI. */
  dataset: string;
  /**
   * The benchmark dataset key this run's vectors came from, when they came from
   * one -- so a restored run can be overlaid on the right reference curves.
   */
  benchmarkDataset?: string | null;
  /**
   * The dataset row this ran against. Restoring keys the results by this, so a
   * reopened run lands in the same panel a fresh one would and picks up that
   * row's reference curves -- rather than a synthetic key nothing matches.
   * Absent on runs stored before this was tracked.
   */
  datasetId?: string;
  /**
   * How many vectors were actually scored, against the dataset's full size.
   * Stored with the run because it is what separates a subsampled score from a
   * full-base one, and a restored run must not silently claim the latter.
   */
  scale?: { sampled: number; total: number };
  results: MethodResult[];
  elapsedSeconds: number;
};

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      // v2: UI preferences that should outlive a reload, keyed by name.
      if (!db.objectStoreNames.contains(PREFS)) {
        db.createObjectStore(PREFS);
      }
      // v3: pipelines the reader composed and named.
      if (!db.objectStoreNames.contains(SAVED)) {
        db.createObjectStore(SAVED, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

/** Run `work` in a transaction and settle when the transaction does. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
  storeName: string = STORE,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    // Surface the transaction's error too: a write can fail after the request
    // itself succeeded (quota, for instance).
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * What makes two runs the same experiment: the same methods at the same bit
 * rates, under the same seed, on the same dataset. Re-running that combination
 * should replace the old entry rather than pile up identical rows -- sweeping a
 * parameter back and forth is normal, and every repeat would otherwise leave a
 * duplicate in the history and a duplicate curve on the plot.
 */
function identityOf(record: RunRecord): string {
  const methods = record.results
    .map((r) => `${r.label}@${r.bits_per_dim.toFixed(4)}`)
    .sort()
    .join(";");
  return `${record.dataset}|${seedOf(record.config)}|${methods}`;
}

/** The seed a config ran under; runs at different seeds are different runs. */
function seedOf(config: string): string {
  try {
    return String((JSON.parse(config) as { seed?: unknown }).seed ?? "");
  } catch {
    return "";
  }
}

export async function saveRun(record: RunRecord): Promise<void> {
  // Drop any earlier run of the same experiment, keeping this one -- the newest
  // numbers are the ones worth having if anything about the build changed.
  const identity = identityOf(record);
  const existing = await listRuns();
  for (const previous of existing) {
    if (previous.id !== record.id && identityOf(previous) === identity) {
      await deleteRun(previous.id);
    }
  }
  await transact("readwrite", (store) => store.put(record));
}

/** Every stored run, newest first. */
export async function listRuns(): Promise<RunRecord[]> {
  const all = await transact<RunRecord[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export async function deleteRun(id: number): Promise<void> {
  await transact("readwrite", (store) => store.delete(id));
}

export async function clearRuns(): Promise<void> {
  await transact("readwrite", (store) => store.clear());
}

/** A pipeline the reader composed, named and kept. */
export type SavedQuantizer = {
  /** The reader's own name for it; also the key, so saving again replaces it. */
  name: string;
  /** The stage list, exactly as the config carries it. */
  stages: { name: string; [param: string]: unknown }[];
  savedAt: number;
};

export async function listSavedQuantizers(): Promise<SavedQuantizer[]> {
  try {
    const all = await transact<SavedQuantizer[]>(
      "readonly",
      (store) => store.getAll(),
      SAVED,
    );
    return all.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveQuantizer(quantizer: SavedQuantizer): Promise<void> {
  await transact("readwrite", (store) => store.put(quantizer), SAVED);
}

export async function deleteQuantizer(name: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(name), SAVED);
}

/** How the results/benchmark overlay is configured, remembered across visits. */
export type OverlayPrefs = {
  /** Whether the published curves are drawn behind your own. */
  show: boolean;
  /** Whether earlier runs on the same dataset are drawn too. */
  history: boolean;
  /** Chart, or the ranked table. */
  view: "chart" | "table";
  /**
   * Which benchmark dataset to compare against, or `null` to follow whatever
   * dataset the run used -- the usual case, and the honest one.
   */
  dataset: string | null;
};

export const DEFAULT_OVERLAY: OverlayPrefs = {
  show: true,
  history: true,
  view: "chart",
  dataset: null,
};

export async function loadOverlayPrefs(): Promise<OverlayPrefs> {
  try {
    const stored = await transact<OverlayPrefs | undefined>(
      "readonly",
      (store) => store.get("overlay"),
      PREFS,
    );
    return { ...DEFAULT_OVERLAY, ...(stored ?? {}) };
  } catch {
    // A preference is not worth failing the page over.
    return DEFAULT_OVERLAY;
  }
}

export async function saveOverlayPrefs(prefs: OverlayPrefs): Promise<void> {
  try {
    await transact("readwrite", (store) => store.put(prefs, "overlay"), PREFS);
  } catch {
    // As above.
  }
}
