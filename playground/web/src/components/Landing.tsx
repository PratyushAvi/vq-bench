// The landing page: what this is on the left, what the benchmark found on the
// right. The plot is the argument -- quantizers are only interesting relative
// to what the same bit budget buys elsewhere.

import { useEffect, useState } from "react";

import { PipelineSlideshow } from "./PipelineSlideshow";
import { TradeoffChart, type Series } from "./TradeoffChart";
import { featuredPipelines, type Pipeline } from "../lib/pipelines";
import { runner } from "../lib/runner";
import { loadSota, shortName, type Sota } from "../lib/sota";
import type { Quantizer } from "../lib/types";

type Props = {
  onOpenPlayground: () => void;
};

export function Landing({ onOpenPlayground }: Props) {
  const [sota, setSota] = useState<Sota | null>(null);
  // One dataset, fixed: the panel is an illustration of the tradeoff, and a
  // picker invited fiddling with it before the reader knew what they were
  // looking at. The playground is where every dataset is available.
  const dataset = "arxiv-nomic-768-normalized";
  const [failed, setFailed] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  useEffect(() => {
    loadSota().then(setSota).catch(() => setFailed(true));
    // The diagrams are read out of the registry, so they cannot drift from
    // what the crate reports. A failure just leaves the slot empty.
    runner()
      .listQuantizers()
      .then((families: Quantizer[]) => setPipelines(featuredPipelines(families)))
      .catch(() => undefined);
  }, []);

  const entry = sota?.datasets[dataset];

  // One row per family, not one per point: each curve is a sweep of the same
  // method at several bit rates, and listing every point buried the five
  // methods the panel is about under twenty-odd rows. Each family is shown at
  // its best recall, which is the number the ranking is read on.
  const best = Object.entries(entry?.curves ?? {})
    .map(([name, points]) => {
      const top = [...points].sort((a, b) => b.recall - a.recall)[0];
      return { name, label: top.label, bits: top.bits, recall: top.recall };
    })
    .sort((a, b) => b.recall - a.recall)
    .slice(0, 5);
  const series: Series[] = entry
    ? Object.entries(entry.curves).map(([name, points]) => ({
        name,
        points: points.map((p) => ({ bits: p.bits, recall: p.recall, label: p.label })),
      }))
    : [];

  return (
    <>
    <div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-12 lg:grid-cols-2">
      <section>
        <h1 className="text-4xl tracking-tight text-slate-900 dark:text-slate-100">
          Vector Quantizer Playground
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
          A playground for{" "}
          <a
            href="https://github.com/pinecone-io/vq-bench"
            target="_blank"
            rel="noreferrer"
            className="text-[#4260f5] font-bold underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
          >
            VQ-Bench
          </a>
          , an open-source benchmark for vector quantization. Run existing state-of-the-art quantizers or <span className="text-[#4260f5] font-bold">build your own!!</span>
        </p>

        <div className="mt-8">
          <PipelineSlideshow pipelines={pipelines} />
        </div>

        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={onOpenPlayground}
            className="cursor-pointer rounded-md border border-transparent bg-slate-900 px-5
                       py-2.5 text-sm font-medium text-white hover:bg-slate-700
                       dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100
                       dark:hover:border-slate-400 dark:hover:bg-slate-700"
          >
            Open the playground
          </button>
          <a
            href="https://arxiv.org/abs/2608.11240"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400
                       dark:hover:text-slate-100"
          >
            Read the paper ↗
          </a>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div className="mb-3">
          <h2 className="text-base text-slate-700 dark:text-slate-300">What the benchmark found</h2>
        </div>

        {failed && (
          <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Reference results are unavailable.
          </p>
        )}
        {!failed && !sota && (
          <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading results…</p>
        )}
        {entry && (
          <>
            <TradeoffChart
              series={series}
              caption="recall@10 against bits per dimension — up and to the left is better"
              xLabel="bits per dimension"
              yLabel="recall@10"
              // Published curves, so the axes carry the metrics' own limits.
              limitX={{ min: 0 }}
              limitY={{ min: 0, max: 1 }}
              height={300}
            />

            {/* The curves bunch: three families sit within 0.02 recall of each
                other, which is a finding in itself but unreadable off the
                plot. The exact numbers live here, always shown -- five rows
                is not worth hiding behind a disclosure. */}
            <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                      <th className="py-1.5 pr-3 font-medium text-slate-700 dark:text-slate-300">method</th>
                      <th className="py-1.5 pr-3 text-right font-medium text-slate-700 dark:text-slate-300">bits/dim</th>
                      <th className="py-1.5 text-right font-medium text-slate-700 dark:text-slate-300">recall@10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {best.map((point) => (
                      <tr key={point.label} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-slate-800 dark:text-slate-200">{point.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {point.bits.toFixed(2)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {point.recall.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Top 5 vector quantizers on {shortName(dataset, entry.dim)} (
              {entry.n_base.toLocaleString()} vectors), from the published{" "}
              <a
                href="https://www.vq-bench.com"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
              >
                VQ-Bench results
              </a>
              .
            </p>
          </>
        )}
      </section>
    </div>

    <section className="mx-auto max-w-6xl px-6 pb-4">
      <div className="grid gap-8 border-t border-slate-200 dark:border-slate-700 pt-8 md:grid-cols-3">
        <Point title="Test Quantizers in your Browser">
          The Rust crate for VQ-Bench is compiled to WebAssembly and called directly. Every score comes
          from the same code the CLI runs.
        </Point>
        <Point title="Compose your own Quantizer">
          Chain VQ-Bench primitives into a vector quantizer of your own.
        </Point>
        <Point title="Run on Custom Datasets">
          Drop in an <span className="font-mono text-black dark:text-white">.h5</span> file and run the quantizers directly
          the browser.
        </Point>
      </div>
    </section>

    <footer className="mx-auto max-w-6xl px-6 pb-12">
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 text-xs text-slate-500 dark:text-slate-400">
        <p>
          Built on top of {" "}
          <a href="https://github.com/pinecone-io/vq-bench" target="_blank" rel="noreferrer"
             className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
            VQ-Bench
          </a>{" "}. Reference results from obtained on
          {/* <a href="https://www.vq-bench.com" target="_blank" rel="noreferrer"
             className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
            vq-bench.com
          </a> */}
          {sota ? `, ${sota.run}.` : "."}{" "}
        </p>
      </div>
    </footer>
    </>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-base text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{children}</p>
    </div>
  );
}
