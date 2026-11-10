// Set NEXT_PUBLIC_API_URL to use the FastAPI server; leave it empty to run the Python
// engine in the browser (Pyodide). See src/lib/engine.ts.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export type Problem = {
  name: string;
  label: string;
  description: string;
  dim: number;
  bounds: [number, number][];
  optimum: number | null;
  constrained: boolean;
  axis_labels: string[];
};

export type Param = { name: string; default: number; min: number; max: number; help: string };

export type Algorithm = { key: string; label: string; description: string; params: Param[] };

export type IterationState = {
  iteration: number;
  population: number[][];
  best_x: number[];
  best_f: number;
  evaluations: number;
};

export type Grid = { x: number[]; y: number[]; z: number[][] };

export type CompareRow = {
  key: string;
  label: string;
  curve: { evaluations: number[]; best_f: number[] };
  mean: number;
  std: number;
  best: number;
  worst: number;
  evaluations: number;
  success_rate: number | null;
};

export type CompareResponse = { problem: Problem; iterations: number; runs: number; results: CompareRow[] };

export async function getJSON<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(path, API_URL);
  Object.entries(params ?? {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function runUrl(opts: {
  problem: string;
  algorithm: string;
  iterations: number;
  seed: number;
  delayMs: number;
  params: Record<string, number>;
}): string {
  const url = new URL("/api/run", API_URL);
  url.searchParams.set("problem", opts.problem);
  url.searchParams.set("algorithm", opts.algorithm);
  url.searchParams.set("iterations", String(opts.iterations));
  url.searchParams.set("seed", String(opts.seed));
  url.searchParams.set("delay_ms", String(opts.delayMs));
  url.searchParams.set("params", JSON.stringify(opts.params));
  return url.toString();
}

export const ALGO_COLORS: Record<string, string> = {
  random: "#94a3b8",
  hill: "#f472b6",
  annealing: "#fb923c",
  pso: "#34d399",
  de: "#60a5fa",
};

export function fmt(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) return v.toExponential(2);
  return v.toFixed(digits);
}
