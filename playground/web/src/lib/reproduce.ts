// Turning a published result's label back into a runnable method config.
//
// The published rows are named the way vq-bench names a configured method --
// `E-RaBitQ (b=4, rotation="hadamard")` -- which carries everything needed to
// build it again. Parsing that is how a reader reruns a benchmark method on
// their own vectors, so the two can be compared at the same scale.

import type { Quantizer } from "./types";

/** `MinMax (b=4)` -> `{ name: "minmax", b: 4 }`, or null if it cannot be read. */
export function methodFromLabel(
  label: string,
  quantizers: Quantizer[],
): Record<string, unknown> | null {
  const match = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(label.trim());
  if (!match) return null;
  const [, display, args] = match;

  // Labels carry the display name; configs take the key.
  const family = quantizers.find((q) => q.family === display.trim());
  if (!family) return null;

  const method: Record<string, unknown> = { name: family.key };
  if (!args) return method;

  for (const part of splitArgs(args)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    // A param the family does not accept would be rejected downstream anyway,
    // but dropping it here keeps the error about what actually matters.
    if (!family.params.includes(key)) continue;
    method[key] = parseValue(raw);
  }
  return method;
}

/** Split on commas that are not inside quotes. */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === '"') depth = depth === 0 ? 1 : 0;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

function parseValue(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  const asNumber = Number(raw);
  return Number.isNaN(asNumber) ? raw : asNumber;
}
