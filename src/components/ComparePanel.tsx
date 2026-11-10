"use client";

import { useState } from "react";

import ConvergenceChart from "@/components/ConvergenceChart";
import { ALGO_COLORS, type CompareResponse, fmt, type Problem } from "@/lib/api";
import type { Engine } from "@/lib/engine";

/** Runs every algorithm on the selected problem several times and compares them fairly
 *  (same evaluation budget on the x-axis, statistics over seeds). */
export default function ComparePanel({ problem, engine }: { problem: Problem; engine: Engine }) {
  const [runs, setRuns] = useState(10);
  const [iterations, setIterations] = useState(100);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await engine.compare(problem.name, iterations, runs));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const current = data?.problem.name === problem.name ? data : null;
  const gap = problem.optimum !== null;
  const rows = current ? [...current.results].sort((a, b) => a.mean - b.mean) : [];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h2 className="text-lg font-semibold">Compare all algorithms</h2>
          <p className="text-sm text-slate-400">
            Default parameters, {runs} seeds each, on <em>{problem.label}</em>.
          </p>
        </div>
        <label className="text-sm">
          <span className="block text-slate-400">Runs</span>
          <input type="number" min={1} max={30} value={runs} onChange={(e) => setRuns(+e.target.value)}
                 className="w-20 rounded bg-slate-800 px-2 py-1" />
        </label>
        <label className="text-sm">
          <span className="block text-slate-400">Iterations</span>
          <input type="number" min={10} max={500} value={iterations} onChange={(e) => setIterations(+e.target.value)}
                 className="w-24 rounded bg-slate-800 px-2 py-1" />
        </label>
        <button onClick={run} disabled={loading}
                className="rounded-lg bg-sky-500 px-4 py-2 font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50">
          {loading ? "Running…" : "Run comparison"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      {current && (
        <div className="mt-6 grid gap-6 2xl:grid-cols-2">
          <ConvergenceChart
            height={300}
            xLabel="objective evaluations"
            yLabel={gap ? "mean gap to optimum" : "mean best value"}
            series={current.results.map((r) => ({
              label: r.label,
              color: ALGO_COLORS[r.key] ?? "#fff",
              x: r.curve.evaluations,
              y: r.curve.best_f.map((v) => (gap ? Math.max(v - (problem.optimum ?? 0), 1e-12) : v)),
            }))}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Algorithm</th>
                  <th className="py-1 pr-3 text-right">Mean ± std</th>
                  <th className="py-1 pr-3 text-right">Best</th>
                  <th className="py-1 pr-3 text-right">Evals</th>
                  {gap && <th className="py-1 text-right">Solved*</th>}
                </tr>
              </thead>
              <tbody className="tabular-nums whitespace-nowrap">
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-800">
                    <td className="py-1.5 pr-3">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: ALGO_COLORS[r.key] }} />
                      {r.label}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{fmt(r.mean)} ± {fmt(r.std)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmt(r.best)}</td>
                    <td className="py-1.5 pr-3 text-right">{r.evaluations.toLocaleString()}</td>
                    {gap && <td className="py-1.5 text-right">{Math.round((r.success_rate ?? 0) * 100)}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {gap && <p className="mt-2 text-xs text-slate-500">* runs ending within 0.01 of the global optimum</p>}
          </div>
        </div>
      )}
    </section>
  );
}
