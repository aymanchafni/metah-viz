// Two interchangeable ways to run the Python engine:
//  * "browser": Pyodide in a Web Worker (default, no server needed: works on Vercel as-is)
//  * "server":  the FastAPI backend, when the app is built with NEXT_PUBLIC_API_URL
import {
  type Algorithm,
  API_URL,
  type CompareResponse,
  getJSON,
  type Grid,
  type IterationState,
  type Problem,
  runUrl,
} from "@/lib/api";

export type RunOptions = {
  problem: string;
  algorithm: string;
  iterations: number;
  seed: number;
  delayMs: number;
  params: Record<string, number>;
};

export type RunHandlers = {
  onState: (s: IterationState) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export interface Engine {
  kind: "browser" | "server";
  ready: Promise<void>;
  problems(): Promise<Problem[]>;
  algorithms(): Promise<Algorithm[]>;
  landscape(name: string, n: number, dims: [number, number], fixed?: number[]): Promise<Grid>;
  compare(problem: string, iterations: number, runs: number): Promise<CompareResponse>;
  /** Starts a run; returns a function that stops it. */
  run(opts: RunOptions, handlers: RunHandlers): () => void;
}

class ServerEngine implements Engine {
  kind = "server" as const;
  ready = Promise.resolve();
  problems = () => getJSON<Problem[]>("/api/problems");
  algorithms = () => getJSON<Algorithm[]>("/api/algorithms");
  landscape(name: string, n: number, dims: [number, number], fixed?: number[]) {
    const q: Record<string, string | number> = { n, dims: dims.join(",") };
    if (fixed) q.fixed = fixed.join(",");
    return getJSON<Grid>(`/api/problems/${name}/grid`, q);
  }
  compare = (problem: string, iterations: number, runs: number) =>
    getJSON<CompareResponse>("/api/compare", { problem, iterations, runs });
  run(opts: RunOptions, h: RunHandlers) {
    const es = new EventSource(runUrl(opts));
    es.onmessage = (e) => h.onState(JSON.parse(e.data));
    es.addEventListener("done", () => {
      es.close();
      h.onDone();
    });
    es.onerror = () => {
      es.close();
      h.onError("Stream interrupted (is the API running?)");
    };
    return () => es.close();
  }
}

type WorkerMessage =
  | { kind: "ready" }
  | { kind: "fatal"; error: string }
  | { kind: "reply"; id: number; ok: boolean; result?: unknown; error?: string }
  | { kind: "state"; id: number; state: IterationState }
  | { kind: "done"; id: number }
  | { kind: "error"; id: number; error: string };

class BrowserEngine implements Engine {
  kind = "browser" as const;
  ready: Promise<void>;
  private worker: Worker;
  private nextId = 1;
  private calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private runs = new Map<number, RunHandlers>();

  constructor() {
    this.worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.kind === "ready") resolve();
        else if (m.kind === "fatal") reject(new Error(m.error));
        else if (m.kind === "reply") {
          const c = this.calls.get(m.id);
          this.calls.delete(m.id);
          if (m.ok) c?.resolve(m.result);
          else c?.reject(new Error(m.error));
        } else if (m.kind === "state") this.runs.get(m.id)?.onState(m.state);
        else if (m.kind === "done") {
          this.runs.get(m.id)?.onDone();
          this.runs.delete(m.id);
        } else if (m.kind === "error") {
          this.runs.get(m.id)?.onError(m.error);
          this.runs.delete(m.id);
        }
      };
    });
  }

  private call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ kind: "call", id, fn, args });
    });
  }

  problems = () => this.call<Problem[]>("problems");
  algorithms = () => this.call<Algorithm[]>("algorithms");
  landscape = (name: string, n: number, dims: [number, number], fixed?: number[]) =>
    this.call<Grid>("landscape", { name, n, dims, fixed: fixed ?? null });
  compare = (problem: string, iterations: number, runs: number) =>
    this.call<CompareResponse>("compare", { problem, iterations, runs });

  run(opts: RunOptions, handlers: RunHandlers) {
    const id = this.nextId++;
    this.runs.set(id, handlers);
    const { delayMs, ...args } = opts;
    this.worker.postMessage({ kind: "run", id, args, delayMs });
    return () => {
      this.runs.delete(id);
      this.worker.postMessage({ kind: "stop", id });
    };
  }
}

let engine: Engine | null = null;

/** Lazily created on the client (Web Workers don't exist during server rendering). */
export function getEngine(): Engine {
  engine ??= API_URL ? new ServerEngine() : new BrowserEngine();
  return engine;
}
