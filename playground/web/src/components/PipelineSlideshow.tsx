// A quantizer as a vertical chain of stages.
//
// Every method in vq-bench is a pipeline of primitives, and that is the idea
// the landing page most needs to land -- so the diagram is the argument, not
// decoration. Stages are coloured by the group vq-bench sorts them into:
// conditioners reshape the vectors, rounders are what actually quantize,
// splitters fan out into branches.

import { useEffect, useRef, useState } from "react";

import type { Pipeline, StageKind } from "../lib/pipelines";

/** How long each pipeline holds before the next, in ms. */
const DWELL = 4200;

const KIND_COLOR: Record<StageKind, string> = {
  conditioner: "var(--stage-conditioner)",
  rounder: "var(--stage-rounder)",
  splitter: "var(--stage-splitter)",
};

const KIND_LABEL: Record<StageKind, string> = {
  conditioner: "conditioner",
  rounder: "rounder",
  splitter: "splitter",
};

export function PipelineSlideshow({ pipelines }: { pipelines: Pipeline[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Cleared on any manual move, so a click is not immediately overridden.
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (paused || pipelines.length < 2) return;
    timer.current = window.setTimeout(
      () => setIndex((i) => (i + 1) % pipelines.length),
      DWELL,
    );
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [index, paused, pipelines.length]);

  if (pipelines.length === 0) {
    return <div className="h-96" aria-hidden />;
  }

  const current = pipelines[Math.min(index, pipelines.length - 1)];
  const kinds = [...new Set(current.stages.map((s) => s.kind))];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6"
    >
      {/* <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-base text-slate-900 dark:text-slate-100">{current.family}</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          every method is a pipeline of primitives
        </span>
      </div> */}

      <div className="mb-1 text-center">
        <h2 className="text-[1.5rem]">{current.family}</h2>
      </div>

      {/* Fixed height, sized for the longest pipeline, with the chain centred:
          the box would otherwise resize on every slide and shift the page.
          aria-live announces the chain as it changes, since the transition
          conveys nothing on its own. */}
      <ol
        aria-live="polite"
        className="my-5 flex h-[26rem] flex-col items-center justify-center gap-0"
      >
        {current.stages.map((stage, i) => (
          <li key={`${current.key}-${i}`} className="flex flex-col items-center">
            <span
              className="rounded-md border-2 px-4 py-2 text-center text-base whitespace-nowrap"
              style={{
                fontFamily: "var(--font-diagram)",
                borderColor: KIND_COLOR[stage.kind],
                color: KIND_COLOR[stage.kind],
                // A tint of the same hue, so the fill reads as the border's
                // family rather than as a second colour.
                backgroundColor: `color-mix(in oklab, ${KIND_COLOR[stage.kind]} 0%, white)`,
              }}
            >
              {stage.label}
            </span>
            {i < current.stages.length - 1 && (
              <svg width="12" height="26" viewBox="0 0 12 26" aria-hidden className="my-0.5">
                <line x1="6" y1="0" x2="6" y2="18" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
                <polygon points="6,25 1.5,17 10.5,17" className="fill-slate-300" />
              </svg>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
        {/* The colour key is only meaningful for the kinds on screen. */}
        <ul className="flex flex-wrap gap-3">
          {kinds.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: KIND_COLOR[kind] }}
              />
              {KIND_LABEL[kind]}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          {pipelines.map((pipeline, i) => (
            <button
              key={pipeline.key}
              onClick={() => setIndex(i)}
              aria-label={`show ${pipeline.family}`}
              aria-current={i === index}
              // A dot is a small target, so the button carries padding well
              // past the mark it draws -- the hit area is the padded box, the
              // dot is only what you see.
              className="group -m-1 cursor-pointer p-1"
            >
              <span
                className={`block h-2.5 rounded-full transition-all ${
                  i === index
                    ? "w-7 bg-slate-700 group-hover:bg-slate-900"
                    : "w-2.5 bg-slate-300 group-hover:bg-slate-500"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
