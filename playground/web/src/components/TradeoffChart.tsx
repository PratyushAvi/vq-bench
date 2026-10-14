// Recall against bit budget: the rate/quality tradeoff every quantizer is
// judged on. One line per family, so the reader compares curves rather than
// reading absolute values -- a quantizer is only interesting relative to what
// the same number of bits buys elsewhere.
//
// Inline SVG rather than a charting library: the shapes are simple, and it
// keeps the dependency surface small.

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { familyOf, styleFor, type Shape } from "../lib/series-style";

export type Series = {
  name: string;
  /** `x`/`y` in whatever units the chosen axes carry, not always bits/recall. */
  points: { bits: number; recall: number; label?: string }[];
  /** Drawn heavier, above the rest -- the reader's own result. */
  emphasis?: boolean;
  /** Context rather than a subject: one quiet grey, thin, no legend colour. */
  muted?: boolean;
};

/** What an axis can physically hold, when its metric has hard limits. */
export type AxisLimit = { min?: number; max?: number };

type Props = {
  series: Series[];
  /** Rendered above the plot; the chart's own caption names the metric. */
  caption?: string;
  height?: number;
  /** Axis titles. Both default to the original bits/recall pairing. */
  xLabel?: string;
  yLabel?: string;
  /** How to print a value in a tooltip -- units differ per axis. */
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  /**
   * The range each axis can meaningfully take: recall lives in 0..1, bits per
   * dimension cannot go negative. Zooming and panning are held inside these,
   * so the view never wanders into coordinates that mean nothing.
   */
  limitX?: AxisLimit;
  limitY?: AxisLimit;
};

// Colour and shape are keyed to the series name, not its index, so a method
// looks the same on every chart in the app -- see lib/series-style.

/** One marker of the given shape, centred on (cx, cy). */
function Marker({ shape, cx, cy, r, fill }: {
  shape: Shape;
  cx: number; cy: number; r: number; fill: string;
}) {
  const common = { fill, stroke: "var(--surface-1, #fff)", strokeWidth: 2 };
  switch (shape) {
    case "square":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} {...common} />;
    case "triangle":
      return <polygon points={`${cx},${cy - r * 1.15} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`} {...common} />;
    case "diamond":
      return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.2},${cy} ${cx},${cy + r * 1.2} ${cx - r * 1.2},${cy}`} {...common} />;
    case "cross":
      return <polygon points={crossPoints(cx, cy, r * 1.2)} {...common} />;
    case "star":
      return <polygon points={starPoints(cx, cy, r * 1.3)} {...common} />;
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

function crossPoints(cx: number, cy: number, r: number): string {
  const t = r * 0.42;
  return [
    [cx - t, cy - r], [cx + t, cy - r], [cx + t, cy - t], [cx + r, cy - t],
    [cx + r, cy + t], [cx + t, cy + t], [cx + t, cy + r], [cx - t, cy + r],
    [cx - t, cy + t], [cx - r, cy + t], [cx - r, cy - t], [cx - t, cy - t],
  ].map(([x, y]) => `${x},${y}`).join(" ");
}

// A y-axis title is drawn rotated in the left margin, so the margin has to
// grow to make room for it; the x title sits in the bottom one.
/** A five-pointed star, for the sixth shape slot. */
function starPoints(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return points.join(" ");
}

type Bounds = { loBits: number; hiBits: number; loRecall: number; hiRecall: number };

/**
 * Hold one axis inside what its metric can mean.
 *
 * A window that runs past a limit is slid back rather than truncated, so the
 * zoom level the reader chose is kept -- panning to the edge stops there
 * instead of squashing the view. Only if the window is wider than the limit
 * itself does it get clipped to it.
 */
function clampAxis(lo: number, hi: number, limit?: AxisLimit): [number, number] {
  if (!limit) return [lo, hi];
  const { min, max } = limit;
  let span = hi - lo;
  if (min !== undefined && max !== undefined && span > max - min) {
    return [min, max];
  }
  if (min !== undefined && lo < min) {
    lo = min;
    hi = min + span;
    if (max !== undefined && hi > max) hi = max;
  }
  if (max !== undefined && hi > max) {
    hi = max;
    lo = max - span;
    if (min !== undefined && lo < min) lo = min;
  }
  return [lo, hi];
}

/** Left-drag either selects a region to zoom into, or pans the view. */
type Tool = "zoom" | "pan";

type Drag = {
  tool: Tool;
  /** Where the drag started, in data units. */
  fromBits: number;
  fromRecall: number;
  /** And in screen units, for drawing the selection rectangle. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** The view when the pan began, so movement is measured against it. */
  start: Bounds;
};

const PAD = { top: 12, right: 16, bottom: 34, left: 42 };
const Y_TITLE_WIDTH = 16;

export function TradeoffChart({
  series,
  caption,
  height = 260,
  xLabel = "bits per dimension",
  yLabel,
  formatX = (v) => v.toFixed(2),
  formatY = (v) => v.toFixed(3),
  limitX,
  limitY,
}: Props) {
  const clipId = useId();
  const [hover, setHover] = useState<{ x: number; y: number; series: string; bits: number; recall: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [width, setWidth] = useState(520);
  // The visible window, once the reader has changed it. `null` means "fit the
  // data", which is also what the reset control restores.
  const [zoom, setZoom] = useState<Bounds | null>(null);
  // A drag in progress: either a rubber-band selection, or a pan.
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("zoom");
  const svgRef = useRef<SVGSVGElement | null>(null);

  // The range the data occupies, padded so end markers are not clipped. Either
  // axis can now be any metric, so the span is measured rather than assumed --
  // recall happens to sit in 0..1, reconstruction error does not.
  const full = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return null;
    const span = (values: number[]) => {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      // A single point, or a flat series, still needs a visible range.
      const pad = hi === lo ? Math.abs(hi) * 0.1 || 0.5 : (hi - lo) * 0.08;
      return [lo - pad, hi + pad] as const;
    };
    const fit = (values: number[], limit?: AxisLimit) => {
      const [lo, hi] = span(values);
      return [
        limit?.min !== undefined ? Math.max(lo, limit.min) : lo,
        limit?.max !== undefined ? Math.min(hi, limit.max) : hi,
      ] as const;
    };
    const [loBits, hiBits] = fit(all.map((p) => p.bits), limitX);
    const [loRecall, hiRecall] = fit(all.map((p) => p.recall), limitY);
    return { loBits, hiBits, loRecall, hiRecall };
  }, [series, limitX, limitY]);

  /** Apply both axis limits to a proposed view. */
  const clamp = (next: Bounds): Bounds => {
    const [loBits, hiBits] = clampAxis(next.loBits, next.hiBits, limitX);
    const [loRecall, hiRecall] = clampAxis(next.loRecall, next.hiRecall, limitY);
    return { loBits, hiBits, loRecall, hiRecall };
  };

  // What is actually shown: `full`, until the reader zooms or pans.
  const bounds = zoom ?? full;

  // Wheel zoom is bound by hand rather than through `onWheel`: React attaches
  // wheel listeners passively, so the handler cannot stop the page scrolling
  // underneath it -- the plot would zoom and the window would move with it.
  useEffect(() => {
    const node = svgRef.current;
    // Hoisted above the early return for empty data: a hook cannot be
    // conditional, so the guard moves inside it.
    if (!node || !bounds) return;
    const onWheel = (event: WheelEvent) => {
      const rect = node.getBoundingClientRect();
      event.preventDefault();
      const edge = PAD.left + (yLabel ? Y_TITLE_WIDTH : 0);
      const w = width - edge - PAD.right;
      const h = height - PAD.top - PAD.bottom;
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const py = ((event.clientY - rect.top) / rect.height) * height;
      scaleAbout(
        event.deltaY > 0 ? 1.15 : 1 / 1.15,
        bounds.loBits + ((px - edge) / w) * (bounds.hiBits - bounds.loBits),
        bounds.loRecall + (1 - (py - PAD.top) / h) * (bounds.hiRecall - bounds.loRecall),
      );
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  });

  if (!bounds || !full) {
    return <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No results to plot yet.</p>;
  }

  const left = PAD.left + (yLabel ? Y_TITLE_WIDTH : 0);
  const plotW = width - left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (bits: number) =>
    left + ((bits - bounds.loBits) / (bounds.hiBits - bounds.loBits)) * plotW;
  const y = (recall: number) =>
    PAD.top + (1 - (recall - bounds.loRecall) / (bounds.hiRecall - bounds.loRecall)) * plotH;

  const xTicks = ticks(bounds.loBits, bounds.hiBits, 5);
  const yTicks = ticks(bounds.loRecall, bounds.hiRecall, 4);

  // `bounds` is non-null past the early return; captured so the closures below
  // see the narrowed value.
  const view = bounds;

  /** Screen point -> data units, for the pointer handlers. */
  function toData(event: React.PointerEvent | React.WheelEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // The SVG scales to its box, so convert through the viewBox first.
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const py = ((event.clientY - rect.top) / rect.height) * height;
    return {
      px,
      py,
      bits: view.loBits + ((px - left) / plotW) * (view.hiBits - view.loBits),
      recall:
        view.loRecall + (1 - (py - PAD.top) / plotH) * (view.hiRecall - view.loRecall),
    };
  }

  /** Scale the view about a fixed point -- the cursor, or the centre. */
  function scaleAbout(factor: number, atBits: number, atRecall: number) {
    setZoom(clamp({
      loBits: atBits - (atBits - view.loBits) * factor,
      hiBits: atBits + (view.hiBits - atBits) * factor,
      loRecall: atRecall - (atRecall - view.loRecall) * factor,
      hiRecall: atRecall + (view.hiRecall - atRecall) * factor,
    }));
  }

  const zoomed = zoom !== null;
  // The centre of the current view, which the +/- buttons scale about.
  const midBits = (view.loBits + view.hiBits) / 2;
  const midRecall = (view.loRecall + view.hiRecall) / 2;


  return (
    <figure className="viz-root m-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        {caption && <figcaption className="text-xs text-slate-500 dark:text-slate-400">{caption}</figcaption>}

        {/* Plot tools. Drag is the primary gesture, so the mode it takes is
            the one control that has to be visible; the rest are shortcuts for
            what the wheel and a double-click already do. */}
        <div className="flex items-center gap-1">
          <div className="flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
            {(["zoom", "pan"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setTool(option)}
                title={option === "zoom" ? "drag a box to zoom into it" : "drag to move the view"}
                className={`cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  tool === option
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <ToolButton label="zoom in" onClick={() => scaleAbout(1 / 1.3, midBits, midRecall)}>
            +
          </ToolButton>
          <ToolButton label="zoom out" onClick={() => scaleAbout(1.3, midBits, midRecall)}>
            −
          </ToolButton>
          <ToolButton
            label="reset the view to fit the data"
            onClick={() => setZoom(null)}
            disabled={!zoomed}
          >
            ⤢
          </ToolButton>
        </div>
      </div>

      <div
        ref={(node) => {
          if (node && node.clientWidth && node.clientWidth !== width) setWidth(node.clientWidth);
        }}
        className="w-full"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={caption ?? "recall against bits per dimension"}
          ref={svgRef}
          onMouseLeave={() => setHover(null)}
          style={{ touchAction: "none", cursor: drag?.tool === "pan" ? "grabbing" : tool === "pan" ? "grab" : "crosshair" }}
          onPointerDown={(e) => {
            const at = toData(e);
            if (!at || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({
              tool,
              fromBits: at.bits,
              fromRecall: at.recall,
              fromX: at.px,
              fromY: at.py,
              toX: at.px,
              toY: at.py,
              start: bounds,
            });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const at = toData(e);
            if (!at) return;
            if (drag.tool === "zoom") {
              setDrag({ ...drag, toX: at.px, toY: at.py });
              return;
            }
            // Pan: hold the grabbed point under the cursor by shifting the
            // window by however far it has moved, in data units.
            const dBits = ((at.px - drag.fromX) / plotW) * (drag.start.hiBits - drag.start.loBits);
            const dRecall =
              (-(at.py - drag.fromY) / plotH) * (drag.start.hiRecall - drag.start.loRecall);
            setZoom(clamp({
              loBits: drag.start.loBits - dBits,
              hiBits: drag.start.hiBits - dBits,
              loRecall: drag.start.loRecall - dRecall,
              hiRecall: drag.start.hiRecall - dRecall,
            }));
          }}
          onPointerUp={() => {
            if (!drag) return;
            if (drag.tool === "zoom") {
              const at = {
                bits:
                  bounds.loBits + ((drag.toX - left) / plotW) * (bounds.hiBits - bounds.loBits),
                recall:
                  bounds.loRecall +
                  (1 - (drag.toY - PAD.top) / plotH) * (bounds.hiRecall - bounds.loRecall),
              };
              // A click, not a drag: too small a box would zoom to nothing.
              if (Math.abs(drag.toX - drag.fromX) > 6 && Math.abs(drag.toY - drag.fromY) > 6) {
                setZoom(clamp({
                  loBits: Math.min(drag.fromBits, at.bits),
                  hiBits: Math.max(drag.fromBits, at.bits),
                  loRecall: Math.min(drag.fromRecall, at.recall),
                  hiRecall: Math.max(drag.fromRecall, at.recall),
                }));
              }
            }
            setDrag(null);
          }}
          onDoubleClick={() => setZoom(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Recessive grid: present enough to read a value off, quiet enough
              that the curves stay the figure. */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-slate-200 dark:stroke-slate-700"
                strokeWidth={1}
              />
              <text
                x={left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[13px] tabular-nums"
              >
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              x={x(t)}
              y={height - PAD.bottom + 14}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-[13px] tabular-nums"
            >
              {formatX(t)}
            </text>
          ))}

          {/* Axis titles. Both are stated: with either axis selectable, an
              unlabelled scale is a number with no unit. */}
          <text
            x={left + plotW / 2}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-600 dark:fill-slate-300 text-[13px] font-medium"
          >
            {xLabel}
          </text>
          {yLabel && (
            <text
              // Rotated about its own centre, up the left margin.
              transform={`translate(11 ${PAD.top + plotH / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-slate-600 dark:fill-slate-300 text-[13px] font-medium"
            >
              {yLabel}
            </text>
          )}

          <g clipPath={`url(#${clipId})`}>
            {series.map((s, i) => {
              // Muted history keeps one quiet grey; everything else is styled
              // by its own name, so a method looks the same on every chart.
              const style = styleFor(familyOf(s.name));
              const color = s.muted ? "var(--series-muted)" : style.color;
              const shape = s.muted ? "circle" : style.shape;
              // Dim the rest while one series is focused; several families sit
              // within 0.02 recall of each other, so this is often the only way
              // to follow a single line.
              const dimmed = focused !== null && focused !== s.name;
              const path = s.points
                .map((p, j) => `${j === 0 ? "M" : "L"}${x(p.bits)},${y(p.recall)}`)
                .join(" ");
              return (
                <g key={`${i}:${s.name}`} opacity={dimmed ? 0.18 : 1}>
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={s.emphasis ? 3 : s.muted ? 1.25 : 2}
                    strokeDasharray={s.muted ? "4 3" : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {s.points.map((p, j) => (
                    <g
                      key={`${s.name}-${j}`}
                      onMouseEnter={() =>
                        setHover({
                          x: x(p.bits),
                          y: y(p.recall),
                          series: p.label ?? s.name,
                          bits: p.bits,
                          recall: p.recall,
                        })
                      }
                    >
                      {/* An invisible disc widens the hit target past the mark. */}
                      <circle cx={x(p.bits)} cy={y(p.recall)} r={11} fill="transparent" />
                      <Marker
                        shape={shape}
                        cx={x(p.bits)}
                        cy={y(p.recall)}
                        r={s.emphasis ? 5.5 : s.muted ? 2.5 : 4}
                        fill={color}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </g>

          {drag?.tool === "zoom" && Math.abs(drag.toX - drag.fromX) > 3 && (
            <rect
              x={Math.min(drag.fromX, drag.toX)}
              y={Math.min(drag.fromY, drag.toY)}
              width={Math.abs(drag.toX - drag.fromX)}
              height={Math.abs(drag.toY - drag.fromY)}
              className="fill-slate-900/5 stroke-slate-500"
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}

          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x}
                x2={hover.x}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-slate-300 dark:stroke-slate-600"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={hover.x} cy={hover.y} r={7} fill="none" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      </div>

      {hover && (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-medium">{hover.series}</span>
          <span className="ml-2 tabular-nums text-slate-500 dark:text-slate-400">
            {xLabel} {formatX(hover.bits)} · {yLabel ?? "value"} {formatY(hover.recall)}
          </span>
        </p>
      )}

      {/* Identity is never colour alone: every series is named here. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s, i) => (
          <li
            key={`${i}:${s.name}`}
            onMouseEnter={() => setFocused(s.name)}
            onMouseLeave={() => setFocused(null)}
            className="flex cursor-default items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
          >
            <svg width={15} height={15} aria-hidden className="shrink-0 overflow-visible">
              <Marker
                shape={s.muted ? "circle" : styleFor(familyOf(s.name)).shape}
                cx={7.5}
                cy={7.5}
                r={s.emphasis ? 5.5 : s.muted ? 3 : 5}
                fill={
                  s.muted ? "var(--series-muted)" : styleFor(familyOf(s.name)).color
                }
              />
            </svg>
            <span
              className={
                s.emphasis
                  ? "font-medium text-slate-900 dark:text-slate-100"
                  : s.muted
                    ? "text-slate-500 dark:text-slate-400"
                    : undefined
              }
            >
              {s.name}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Round tick values spanning `lo..hi`, at most `count` of them. */
function ticks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    out.push(Number(t.toFixed(6)));
  }
  return out;
}

/** One icon button in the plot toolbar. */
function ToolButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="cursor-pointer rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 text-xs leading-none text-slate-600 dark:text-slate-400 hover:border-slate-500 dark:hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
