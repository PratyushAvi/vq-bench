// A stable colour and marker for each quantizer family.
//
// Colour must follow the entity, never its position in a list: with an
// index-based palette the same method is blue on one dataset's chart and
// orange on the next, and a reader comparing two panels side by side is misled
// by the change. Deriving the slot from the family name instead fixes each
// method's appearance across every chart in the app, however many series a
// particular plot happens to draw.

/** How many categorical slots the palette defines (see index.css). */
export const SLOTS = 6;

/** Marker shapes, so near-identical curves stay separable without colour. */
export const SHAPES = ["circle", "square", "triangle", "diamond", "cross", "star"] as const;

export type Shape = (typeof SHAPES)[number];

/**
 * The families vq-bench registers, in the order the crate lists them.
 *
 * Named explicitly so the common methods get well-separated slots rather than
 * whatever a hash happens to produce; anything not listed -- a composed
 * pipeline, a renamed family -- falls back to a hash of its name, which is
 * stable for that name even though it was not planned for.
 */
const KNOWN = [
  "MinMax", "Scalar", "SimHash", "RaBitQ", "E-RaBitQ", "ITQ", "ITQ-asym",
  "QJL", "EDEN-MSE", "EDEN-prod", "TurboQuant-MSE", "TurboQuant-prod",
  "PQ", "OPQ", "OPQ-par",
];

const SLOT_OF = new Map(KNOWN.map((name, i) => [name, i]));

/** A small stable hash, so an unregistered name still gets a fixed slot. */
function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

/** The palette index this family always uses. */
function slotOf(family: string): number {
  return SLOT_OF.get(family) ?? hash(family);
}

/**
 * Colour and shape for a series.
 *
 * Colour and marker advance at different rates, so two families sharing a
 * colour take different shapes and two sharing a shape take different colours
 * -- identity survives more series than either channel alone carries.
 */
export function styleFor(family: string): { color: string; shape: Shape } {
  const slot = slotOf(family);
  return {
    color: `var(--series-${(slot % SLOTS) + 1})`,
    shape: SHAPES[Math.floor(slot / SLOTS) % SHAPES.length],
  };
}

/** The family a method label names: `MinMax (b=4)` -> `MinMax`. */
export function familyOf(label: string): string {
  return label.split(" (")[0];
}
