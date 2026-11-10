// Runs the Python engine (src/api/metaheuristics) in the browser with Pyodide.
// The UI talks to it with small JSON messages; see src/lib/engine.ts.

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

type PyCallable = (...args: unknown[]) => unknown;
type Pyodide = {
  loadPackage(name: string): Promise<void>;
  runPython(code: string): unknown;
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
  globals: { get(name: string): PyCallable };
};

type WorkerRequest =
  | { kind: "call"; id: number; fn: string; args: Record<string, unknown> }
  | { kind: "run"; id: number; args: Record<string, unknown>; delayMs: number }
  | { kind: "stop"; id: number };

const ctx = self as unknown as { postMessage(msg: unknown): void; onmessage: (e: MessageEvent<WorkerRequest>) => void };

const BOOTSTRAP = `
import json, sys
sys.path.insert(0, "/home/pyodide")
from metaheuristics import service

_runs = {}

def _call(fn, args_json):
    try:
        return json.dumps({"ok": True, "result": getattr(service, fn)(**json.loads(args_json))})
    except Exception as e:
        return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

def _start(run_id, args_json):
    a = json.loads(args_json)
    opt = service.make_optimizer(a["algorithm"], a["problem"], a.get("seed"), a.get("params"))
    _runs[run_id] = (opt, service.run(opt, a["iterations"]))

def _step(run_id):
    try:
        return json.dumps(next(_runs[run_id][1]))
    except StopIteration:
        return None

def _finish(run_id):
    opt, _ = _runs.pop(run_id)
    return json.dumps(service.summary(opt))

def _discard(run_id):
    _runs.pop(run_id, None)
`;

async function boot(): Promise<Pyodide> {
  const mod = await import(/* webpackIgnore: true */ `${PYODIDE_URL}pyodide.mjs`);
  const py: Pyodide = await mod.loadPyodide({ indexURL: PYODIDE_URL });
  await py.loadPackage("numpy");
  const files: string[] = await (await fetch("/py/manifest.json")).json();
  py.FS.mkdirTree("/home/pyodide/metaheuristics");
  for (const f of files) {
    py.FS.writeFile(`/home/pyodide/metaheuristics/${f}`, await (await fetch(`/py/metaheuristics/${f}`)).text());
  }
  py.runPython(BOOTSTRAP);
  return py;
}

const pyodide = boot();
pyodide.then(
  () => ctx.postMessage({ kind: "ready" }),
  (e) => ctx.postMessage({ kind: "fatal", error: String(e) }),
);

const stopped = new Set<number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(msg: WorkerRequest) {
  const py = await pyodide;
  if (msg.kind === "stop") {
    stopped.add(msg.id);
    return;
  }
  if (msg.kind === "call") {
    const res = JSON.parse(py.globals.get("_call")(msg.fn, JSON.stringify(msg.args)) as string);
    ctx.postMessage({ kind: "reply", id: msg.id, ...res });
    return;
  }
  // kind === "run": stream one message per iteration
  try {
    py.globals.get("_start")(msg.id, JSON.stringify(msg.args));
  } catch (e) {
    ctx.postMessage({ kind: "error", id: msg.id, error: String(e) });
    return;
  }
  const step = py.globals.get("_step");
  while (!stopped.has(msg.id)) {
    const state = step(msg.id) as string | undefined;
    if (state == null) {
      ctx.postMessage({ kind: "done", id: msg.id, summary: JSON.parse(py.globals.get("_finish")(msg.id) as string) });
      return;
    }
    ctx.postMessage({ kind: "state", id: msg.id, state: JSON.parse(state) });
    await sleep(msg.delayMs);
  }
  py.globals.get("_discard")(msg.id);
  stopped.delete(msg.id);
}

ctx.onmessage = (e) => {
  handle(e.data);
};

export {};
