// Your runs against the published results, as a ranked table.
//
// The chart shows the shape of the tradeoff; this shows the order. Ranking is
// by recall, but recall tracks the bit budget closely -- a 6-bit method beats a
// 2-bit one almost by definition -- so bits/dim sits right next to it and every
// column sorts, which is how you compare at a fixed rate.

import { useMemo, useState } from "react";

import type { SotaPoint } from "../lib/sota";
import type { MethodResult } from "../lib/types";

export type Row = {
  label: string;
  bits: number;
  recall: number;
  mseRecon: number | undefined;
  /** A run of the reader's own, rather than a published result. */
  mine: boolean;
  /** How many base vectors it scored over, and whether that was all of them. */
  scale: { n: number; full: boolean } | null;
  /** Rank over every row, by the active sort. */
  rank: number;
};

type Column = "rank" | "bits" | "recall" | "mseRecon";

type Props = {
  results: MethodResult[];
  reference: SotaPoint[];
  k: number;
  /** The vectors this run scored over, and the dataset's full size. */
  scale?: { sampled: number; total: number };
  /** The published results' base size, for the same comparison. */
  referenceScale?: number;
  /**
   * Run a published method's own configuration on the reader's vectors. The
   * published rows were measured on the full base; reproducing one here is the
   * only way to compare against them at the same scale.
   */
  onReproduce?: (label: string) => void;
  /** Labels currently being reproduced, so their buttons can show it. */
  reproducing?: string[];
};

export function Leaderboard({
  results,
  reference,
  k,
  scale,
  referenceScale,
  onReproduce,
  reproducing = [],
}: Props) {
  const [sort, setSort] = useState<Column>("recall");
  const [descending, setDescending] = useState(true);

  const rows = useMemo(() => {
    const mine: Row[] = results
      .map((row) => {
        const recall = (row.recall as Record<string, number> | undefined)?.[String(k)];
        return recall === undefined
          ? null
          : {
              label: row.label,
              bits: row.bits_per_dim,
              recall,
              mseRecon: typeof row.mse_recon === "number" ? row.mse_recon : undefined,
              mine: true,
              scale: scale
                ? { n: scale.sampled, full: scale.sampled >= scale.total }
                : null,
              rank: 0,
            };
      })
      .filter((r): r is Row => r !== null);

    const all = mine;
    const direction = descending ? -1 : 1;
    all.sort((a, b) => {
      const key = sort === "rank" ? "recall" : sort;
      const delta = (a[key] as number) - (b[key] as number);
      // mse is better when smaller, so its natural order is the other way.
      return (sort === "mseRecon" ? -delta : delta) * direction;
    });
    all.forEach((row, i) => {
      row.rank = i + 1;
    });
    return all;
  }, [results, reference, k, sort, descending, scale, referenceScale]);

  function toggle(column: Column) {
    if (column === sort) {
      setDescending((d) => !d);
    } else {
      setSort(column);
      setDescending(column !== "mseRecon");
    }
  }

  // What the benchmark published for the same method, keyed by label, so a row
  // can cite it without pretending it is comparable.
  const published = new Map(reference.map((point) => [point.label, point]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-300 dark:border-slate-600 text-left">
            <th className="w-10 py-2 pr-2 text-right font-medium text-slate-500 dark:text-slate-400">#</th>
            {onReproduce && <th className="w-8 py-2" />}
            <th className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-300">method</th>
            <th className="py-2 pr-4 font-medium text-slate-500 dark:text-slate-400">vectors</th>
            <Header label="bits/dim" active={sort === "bits"} descending={descending}
                    onClick={() => toggle("bits")} />
            <Header label={`recall@${k}`} active={sort === "recall"} descending={descending}
                    onClick={() => toggle("recall")} />
            <Header label="mse_recon" active={sort === "mseRecon"} descending={descending}
                    onClick={() => toggle("mseRecon")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const cited = published.get(row.label);
            return (
              <tr
                key={`${i}:${row.label}`}
                className="border-b border-slate-100 dark:border-slate-800 last:border-0"
              >
                <td
                  className={`py-1.5 pr-2 text-right tabular-nums ${
                    row.mine ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {row.rank}
                </td>
                {onReproduce && (
                  <td className="py-1.5 pr-1">
                    {!row.mine && (
                      <button
                        onClick={() => onReproduce(row.label)}
                        disabled={reproducing.includes(row.label)}
                        title={`run ${row.label} on your vectors`}
                        aria-label={`reproduce ${row.label} on your vectors`}
                        className="rounded border border-slate-300 dark:border-slate-600 px-1 text-xs leading-4 text-slate-500 dark:text-slate-400 hover:border-slate-500 dark:hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {reproducing.includes(row.label) ? "…" : "▶"}
                      </button>
                    )}
                  </td>
                )}
                <td className="py-1.5 pr-4">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{row.label}</span>
                  {/* The published figure for the same method, on the full
                      base. A reference point, not a competitor: the two were
                      measured at different scales. */}
                  {cited && (
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      published: {cited.recall.toFixed(3)} @ {cited.bits.toFixed(2)} bits
                      {referenceScale ? ` on ${compact(referenceScale)}` : ""}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4 text-xs whitespace-nowrap">
                  {row.scale === null ? (
                    <span className="text-slate-500 dark:text-slate-400">--</span>
                  ) : row.scale.full ? (
                    <span className="text-slate-500 dark:text-slate-400">
                      {compact(row.scale.n)} full
                    </span>
                  ) : (
                    <span
                      className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                      title="a subsample usually scores higher than the full base"
                    >
                      {compact(row.scale.n)} sample
                    </span>
                  )}
                </td>
                <Cell mine={row.mine}>{row.bits.toFixed(2)}</Cell>
                <Cell mine={row.mine}>{row.recall.toFixed(3)}</Cell>
                <Cell mine={row.mine}>
                  {row.mseRecon === undefined ? "--" : format(row.mseRecon)}
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>

      {published.size > 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          The <span className="text-slate-500 dark:text-slate-400">published</span> figures are vq-bench's own,
          measured over the full base. Your rows scored a subsample, which is an easier
          search, so the two are not directly comparable — run the registered quantizers on
          this sub-sample to compare at the same scale.
        </p>
      )}
      {rows.some((r) => r.scale && !r.scale.full) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Rows marked <span className="rounded bg-amber-50 px-1 py-0.5 text-amber-700">sample</span>{" "}
          scored a subsample; the published rows cover the full base. A smaller base is an
          easier search, so a subsampled run usually reads higher than it would at full
          scale — the ranking flatters it.
          {onReproduce && (
            <> Press <span className="font-mono">▶</span> on a published row to run that
            method on your own vectors, which compares the two at the same scale.</>
          )}
        </p>
      )}
    </div>
  );
}

function Header({
  label,
  active,
  descending,
  onClick,
}: {
  label: string;
  active: boolean;
  descending: boolean;
  onClick: () => void;
}) {
  return (
    <th className="py-2 pr-4 text-right font-medium">
      <button
        onClick={onClick}
        className={`hover:text-slate-900 dark:hover:text-slate-100 dark:hover:text-slate-100 ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}
      >
        {label}
        <span aria-hidden className="ml-1 text-xs text-slate-500 dark:text-slate-400">
          {active ? (descending ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

function Cell({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <td
      className={`py-1.5 pr-4 text-right tabular-nums ${
        mine ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
      }`}
    >
      {children}
    </td>
  );
}

/** `1344643` -> `1.3M`; the column is a scale cue, not an exact count. */
function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function format(value: number): string {
  if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
  return value.toPrecision(4);
}
