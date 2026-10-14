// How to render an input for a quantizer param.
//
// The registry reports param *names* but not their types, so the shapes live
// here. This table is a rendering hint only -- never a source of truth about
// what is valid. Every value is checked by `validate_config`, which calls the
// quantizer's own `build`, so a wrong guess here shows up as a real error from
// vq-bench rather than as a silently accepted bad run.
//
// An unlisted param falls back to a free-text field, so a param added upstream
// still works before anyone touches this file.

export type ParamShape =
  | { kind: "int"; min: number; max?: number; fallback: number; hint: string }
  | { kind: "choice"; options: string[]; fallback: string; hint: string }
  | { kind: "text"; fallback: string; hint: string };

const SHAPES: Record<string, ParamShape> = {
  // Primitive params. `lo`/`hi`/`scale`/`offset` are floats, so they stay text
  // rather than pretending to be integers.
  lo: { kind: "text", fallback: "0", hint: "range floor" },
  hi: { kind: "text", fallback: "1", hint: "range ceiling" },
  scale: { kind: "text", fallback: "1", hint: "multiplier" },
  offset: { kind: "text", fallback: "0", hint: "addend" },
  dim: { kind: "int", min: 1, fallback: 128, hint: "output dimensions" },
  seed: { kind: "int", min: 0, fallback: 1, hint: "overrides the run seed" },
  mode: {
    kind: "choice",
    options: ["plain", "mse", "unbiased"],
    fallback: "plain",
    hint: "dequant scale",
  },
  // 1..=8: the bit-packer's field width is one byte (util/coding.rs MAX_BITS).
  b: { kind: "int", min: 1, max: 8, fallback: 4, hint: "bits per dimension" },
  centroids: { kind: "int", min: 1, fallback: 256, hint: "codewords per segment" },
  section_dim: { kind: "int", min: 1, fallback: 8, hint: "columns per segment" },
  iters: { kind: "int", min: 1, fallback: 25, hint: "optimization rounds" },
  rotation: {
    kind: "choice",
    options: ["hadamard", "full"],
    fallback: "hadamard",
    hint: "random rotation",
  },
  init: {
    kind: "choice",
    options: ["eigen", "identity"],
    fallback: "eigen",
    hint: "rotation initialization",
  },
};

export function shapeOf(param: string): ParamShape {
  return SHAPES[param] ?? { kind: "text", fallback: "", hint: param };
}

/** The starting value for a param, as a string (what an input holds). */
export function defaultValue(param: string): string {
  return String(shapeOf(param).fallback);
}

/**
 * Turn the form's strings into config JSON values. A comma-separated numeric
 * field becomes an array, which vq-bench reads as a sweep -- so `2, 4, 6` runs
 * three quantizers, exactly as it does in a CLI config.
 */
export function toConfigValue(param: string, raw: string): unknown {
  const shape = shapeOf(param);
  const text = raw.trim();
  if (text === "") return undefined;

  if (shape.kind === "int") {
    const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
    const numbers = parts.map(Number);
    // Leave unparseable input alone and let vq-bench report it, rather than
    // coercing it to NaN here.
    if (numbers.some(Number.isNaN)) return text;
    return numbers.length === 1 ? numbers[0] : numbers;
  }
  if (shape.kind === "text") {
    // A bare number in a float field should reach vq-bench as a number.
    const asNumber = Number(text);
    if (text !== "" && !Number.isNaN(asNumber)) return asNumber;
  }
  return text;
}
