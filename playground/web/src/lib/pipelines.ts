// Reading a quantizer's pipeline out of the registry.
//
// `list_quantizers()` reports each family's shape as the string vq-bench uses
// for `vqb show quantizers` -- "Center -> Normalize -> Rotate -> CastAngular(b)".
// Parsing that keeps the diagram tied to what the crate actually reports, so a
// pipeline changed upstream changes here too.

import type { Quantizer } from "./types";

/** The three groups vq-bench sorts primitives into (`vqb show primitives`). */
export type StageKind = "conditioner" | "rounder" | "splitter";

export type Stage = {
  /** The stage as written, e.g. `CastAngular(b)`. */
  label: string;
  kind: StageKind;
};

export type Pipeline = {
  key: string;
  family: string;
  stages: Stage[];
};

// Rounders are the stages that actually quantize; splitters fan out into
// branches. Everything else conditions the vectors on the way through.
const ROUNDERS = /^(Cast|Kmeans|PQ$)/;
const SPLITTERS = /^(SegmentSplit|Split)/;

function kindOf(label: string): StageKind {
  // Strip a branch's brackets first: `[Kmeans(centroids)]` is still a rounder,
  // and an unstripped `[` stops the head from matching at all.
  const head = label.trim().replace(/^\[|\]$/g, "").split("(")[0].trim();
  if (SPLITTERS.test(head)) return "splitter";
  if (ROUNDERS.test(head)) return "rounder";
  return "conditioner";
}

/**
 * Split a `describe` string into stages.
 *
 * A branch written `[Kmeans(centroids)]` is one stage: the diagram is a linear
 * chain, and showing the branch as a single box says what happens without
 * pretending to draw the fan-out.
 */
export function pipelineOf(quantizer: Quantizer): Pipeline {
  const stages = quantizer.describe
    .split("->")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => ({ label: readable(label), kind: kindOf(label) }));
  return { key: quantizer.key, family: quantizer.family, stages };
}

/**
 * Space out a stage name for the diagram: `CastAngular(b)` -> `Cast Angular b`.
 *
 * The boxes are set in a face with only capitals, where camel case runs
 * together and brackets read as noise. The parameter still shows -- it is the
 * interesting part -- just without the punctuation.
 */
function readable(label: string): string {
  // A branch is written `[Kmeans(centroids)]`; the markers are noise here.
  const bare = label.trim().replace(/^\[|\]$/g, "");
  const open = bare.indexOf("(");
  const head = open === -1 ? bare : bare.slice(0, open);
  const params =
    open === -1 ? "" : bare.slice(open + 1).replace(/\)\s*$/, "").trim();
  const spaced = head.trim().replace(/([a-z])([A-Z])/g, "$1 $2");
  return params ? `${spaced} · ${params}` : spaced;
}

/**
 * The families worth showing, in the order they read best: simple chains
 * first, so the shape is legible before the longer pipelines arrive.
 */
const FEATURED = [
  "minmax",
  "simhash",
  "e_rabitq",
  "itq",
  "eden_mse",
  "turboquant_prod",
  "pq",
  "opq",
];

export function featuredPipelines(quantizers: Quantizer[]): Pipeline[] {
  return FEATURED.map((key) => quantizers.find((q) => q.key === key))
    .filter((q): q is Quantizer => q !== undefined)
    .map(pipelineOf);
}
