// The metrics a result row carries, as selectable plot axes.
//
// vq-bench reports metrics in three shapes: plain numbers (`mse_score`),
// nested by k (`recall`), and nested twice by temperature then k (`exp_sos`).
// Rather than name them here -- which would go stale the moment the crate adds
// one -- the axes are discovered from the rows themselves, exactly as the
// results table discovers its columns.

import type { MethodResult } from "./types";

export type Axis = {
  /** `recall@10`, `bits_per_dim`, `exp_sos@0.5/10` -- also the select value. */
  key: string;
  /** What to print on the axis and in the tooltip. */
  label: string;
  read: (row: MethodResult) => number | undefined;
};

/** Every metric present on these rows, as an axis. */
export function axesOf(results: MethodResult[]): Axis[] {
  const found = new Map<string, Axis>();

  for (const row of results) {
    for (const [name, value] of Object.entries(row)) {
      if (name === "label") continue;

      if (typeof value === "number") {
        found.set(name, { key: name, label: name, read: (r) => r[name] as number });
        continue;
      }
      if (!value || typeof value !== "object") continue;

      for (const [inner, nested] of Object.entries(value as Record<string, unknown>)) {
        if (nested && typeof nested === "object") {
          for (const leaf of Object.keys(nested as Record<string, unknown>)) {
            const key = `${name}@${inner}/${leaf}`;
            found.set(key, {
              key,
              label: key,
              read: (r) =>
                (r[name] as Record<string, Record<string, number>> | undefined)?.[inner]?.[leaf],
            });
          }
          continue;
        }
        const key = `${name}@${inner}`;
        found.set(key, {
          key,
          label: key,
          read: (r) => (r[name] as Record<string, number> | undefined)?.[inner],
        });
      }
    }
  }

  // bits_per_dim first: it is the cost every other number is traded against,
  // and the usual x axis.
  return [...found.values()].sort((a, b) => {
    if (a.key === "bits_per_dim") return -1;
    if (b.key === "bits_per_dim") return 1;
    return a.key.localeCompare(b.key);
  });
}

/** The axis to start on, by key, falling back to whatever exists. */
export function pick(axes: Axis[], preferred: string[], fallback = 0): Axis | undefined {
  for (const key of preferred) {
    const found = axes.find((a) => a.key === key);
    if (found) return found;
  }
  return axes[fallback];
}

/** Axis-appropriate formatting: ratios read plainly, errors need exponents. */
export function formatValue(key: string, value: number): string {
  if (key.startsWith("recall") || key.startsWith("sos")) return value.toFixed(3);
  if (key === "bits_per_dim") return value.toFixed(2);
  if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
  return value.toPrecision(4);
}

/**
 * What range a metric can physically take.
 *
 * Recall is a proportion and cannot leave 0..1; bits per dimension and the
 * error metrics are non-negative but have no ceiling. Anything unrecognised
 * gets no limit rather than a guessed one.
 */
export function limitOf(key: string): { min?: number; max?: number } | undefined {
  if (/^(recall|sos|exp_sos)/.test(key)) return { min: 0, max: 1 };
  if (/^(bits_per_dim|mse|kl|tv)/.test(key)) return { min: 0 };
  return undefined;
}

/**
 * Which corner is better, for the "up and to the left" hint.
 *
 * Recall-style metrics are better high; error-style metrics better low. Said
 * plainly rather than inferred, so a metric whose direction is not obvious
 * simply gets no claim made about it.
 */
export function betterHigh(key: string): boolean | null {
  if (/^(recall|sos|exp_sos)/.test(key)) return true;
  if (/^(mse|kl|tv|bits_per_dim)/.test(key)) return false;
  return null;
}
