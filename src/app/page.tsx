"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ComparePanel from "@/components/ComparePanel";
import ConvergenceChart from "@/components/ConvergenceChart";
import Landscape from "@/components/Landscape";
import {
  ALGO_COLORS,
  type Algorithm,
  fmt,
  getJSON,
  type Grid,
  type IterationState,
  type Problem,
  runUrl,
} from "@/lib/api";

type Status = "idle" | "running" | "done" | "error";

export default function Home() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([]);
  const [problemName, setProblemName] = useState("rastrigin");
  const [algoKey, setAlgoKey] = useState("pso");
  const [params, setParams] = useState<Record<string, number>>({});
  const [iterations, setIterations] = useState(120);
  const [delayMs, setDelayMs] = useState(60);
  const [seed, setSeed] = useState(7);
  const [dims, setDims] = useState<[number, number]>([0, 1]);

  const [grid, setGrid] = useState<Grid | null>(null);
  const [history, setHistory] = useState<IterationState[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  const problem = problems.find((p) => p.name === problemName);
  const algorithm = algorithms.find((a) => a.key === algoKey);
  const last = history.at(-1);

  // Catalogue (problems + algorithms with their tunable parameters)
  useEffect(() => {
    Promise.all([getJSON<Problem[]>("/api/problems"), getJSON<Algorithm[]>("/api/algorithms")])
      .then(([p, a]) => {
        setProblems(p);
        setAlgorithms(a);
      })
      .catch((e) => {
        setError(`Cannot reach the API: ${e}`);
        setStatus("error");
      });
  }, []);

  // Reset parameters to the algorithm's defaults when it changes
  useEffect(() => {
    if (algorithm) setParams(Object.fromEntries(algorithm.params.map((p) => [p.name, p.default])));
  }, [algorithm]);

  const stop = useCallback(() => {
    source.current?.close();
    source.current = null;
  }, []);

  // Close the stream when the page unmounts (the old version leaked a connection per render)
  useEffect(() => stop, [stop]);

  // Landscape: for >2-D problems, a 2-D slice through the best point found so far
  const sliceKey = problem && problem.dim > 2 && status !== "running" ? last?.best_x.join(",") : undefined;
  useEffect(() => {
    if (!problem) return;
    const query: Record<string, string | number> = { n: 90, dims: dims.join(",") };
    if (sliceKey) query.fixed = sliceKey;
    getJSON<Grid>(`/api/problems/${problem.name}/grid`, query).then(setGrid).catch(() => setGrid(null));
  }, [problem, dims, sliceKey]);

  const selectProblem = (name: string) => {
    stop();
    setStatus("idle");
    setHistory([]);
    setProblemName(name);
    const p = problems.find((x) => x.name === name);
    setDims(p && p.dim > 2 ? [2, 3] : [0, 1]);
  };

  const start = () => {
    if (!problem || !algorithm) return;
    stop();
    setHistory([]);
    setError(null);
    setStatus("running");
    const es = new EventSource(runUrl({ problem: problem.name, algorithm: algorithm.key, iterations, seed, delayMs, params }));
    es.onmessage = (e) => setHistory((h) => [...h, JSON.parse(e.data) as IterationState]);
    es.addEventListener("done", () => {
      es.close();
      setStatus("done");
    });
    es.onerror = () => {
      es.close();
      setStatus((s) => (s === "running" ? "error" : s));
      setError((err) => err ?? "Stream interrupted (is the API running?)");
    };
    source.current = es;
  };

  const trail = useMemo(() => {
    const t: number[][] = [];
    for (const s of history) if (!t.length || s.best_x.some((v, k) => v !== t[t.length - 1][k])) t.push(s.best_x);
    return t;
  }, [history]);

  const gapMode = problem?.optimum !== null && problem?.optimum !== undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-sky-400">metaheuristics · live</p>
        <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Metah-Viz</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Watch optimization algorithms search a landscape in real time. A Python (FastAPI + NumPy) backend runs the
          algorithm and streams every iteration to the browser over Server-Sent Events.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ---------------- controls ---------------- */}
        <aside className="space-y-5 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <label className="block text-sm">
            <span className="text-slate-400">Problem</span>
            <select value={problemName} onChange={(e) => selectProblem(e.target.value)}
                    className="mt-1 w-full rounded bg-slate-800 px-2 py-2">
              {problems.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
            </select>
            {problem && <span className="mt-1 block text-xs text-slate-500">{problem.description}</span>}
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Algorithm</span>
            <select value={algoKey} onChange={(e) => setAlgoKey(e.target.value)}
                    className="mt-1 w-full rounded bg-slate-800 px-2 py-2">
              {algorithms.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            {algorithm && <span className="mt-1 block text-xs text-slate-500">{algorithm.description}</span>}
          </label>

          {algorithm && (
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-2 text-sm text-slate-400">Parameters</legend>
              {algorithm.params.map((p) => (
                <label key={p.name} className="text-xs" title={p.help}>
                  <span className="text-slate-400">{p.name}</span>
                  <input type="number" min={p.min} max={p.max} step="any" value={params[p.name] ?? p.default}
                         onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}
                         className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
                </label>
              ))}
            </fieldset>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>
              <span className="text-slate-400">Iterations</span>
              <input type="number" min={1} max={2000} value={iterations}
                     onChange={(e) => setIterations(+e.target.value)} className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
            </label>
            <label>
              <span className="text-slate-400">Seed</span>
              <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)}
                     className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
            </label>
            <label className="col-span-2">
              <span className="text-slate-400">Speed ({delayMs} ms / iteration)</span>
              <input type="range" min={0} max={300} step={10} value={delayMs}
                     onChange={(e) => setDelayMs(+e.target.value)} className="mt-1 w-full accent-sky-400" />
            </label>
          </div>

          {problem && problem.dim > 2 && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[0, 1].map((axis) => (
                <label key={axis}>
                  <span className="text-slate-400">{axis ? "Y axis" : "X axis"}</span>
                  <select value={dims[axis]} className="mt-1 w-full rounded bg-slate-800 px-2 py-1"
                          onChange={(e) => {
                            const next: [number, number] = [...dims];
                            next[axis] = +e.target.value;
                            if (next[0] !== next[1]) setDims(next);
                          }}>
                    {problem.axis_labels.map((l, k) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              ))}
              <p className="col-span-2 text-slate-500">
                {problem.dim}-D problem: the map is a slice through the best point found
                {problem.constrained && "; the bright region is infeasible (penalised)"}.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={start} disabled={!problem || !algorithm}
                    className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              {status === "running" ? "Restart" : "Run"}
            </button>
            <button onClick={() => { stop(); setStatus("done"); }} disabled={status !== "running"}
                    className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-800 disabled:opacity-40">
              Stop
            </button>
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </aside>

        {/* ---------------- visualisation ---------------- */}
        <section className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_1fr]">
            {problem ? (
              <Landscape problem={problem} grid={grid} dims={dims}
                         population={last?.population ?? []} best={last?.best_x ?? null} trail={trail} />
            ) : (
              <div className="aspect-square max-w-[560px] animate-pulse rounded-lg bg-slate-800" />
            )}

            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Iteration", last ? `${last.iteration + 1} / ${iterations}` : "–"],
                  ["Evaluations", last ? last.evaluations.toLocaleString() : "–"],
                  ["Best f(x)", fmt(last?.best_f)],
                  ["Known optimum", problem?.optimum === null ? "unknown" : fmt(problem?.optimum)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-900/80 p-3">
                    <dt className="text-xs text-slate-400">{k}</dt>
                    <dd className="mt-1 font-mono text-lg tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {last && problem && (
                <p className="break-words font-mono text-xs text-slate-400">
                  best x = [{last.best_x.map((v) => fmt(v, 3)).join(", ")}]
                </p>
              )}
              <ConvergenceChart
                xLabel="iteration"
                yLabel={gapMode ? "gap to optimum (best so far)" : "best so far"}
                series={[{
                  label: algorithm?.label ?? "",
                  color: ALGO_COLORS[algoKey] ?? "#fff",
                  x: history.map((s) => s.iteration + 1),
                  y: history.map((s) => (gapMode ? Math.max(s.best_f - (problem?.optimum ?? 0), 1e-12) : s.best_f)),
                }]}
              />
              <p className="text-xs text-slate-500">
                White dots: points evaluated this iteration. Red star: best so far. White line: path of the best solution.
              </p>
            </div>
          </div>

          {problem && <ComparePanel problem={problem} />}
        </section>
      </div>

      <footer className="mt-12 text-xs text-slate-500">
        Built by <a className="text-sky-400 hover:underline" href="https://aymanchafni.github.io">Ayman Chafni</a> ·{" "}
        <a className="text-sky-400 hover:underline" href="https://github.com/aymanchafni/metah-viz">source</a>
      </footer>
    </main>
  );
}
