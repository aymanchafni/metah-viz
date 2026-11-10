# Metah-Viz: metaheuristics, live

![CI](https://github.com/aymanchafni/metah-viz/actions/workflows/ci.yml/badge.svg)

An interactive lab for optimization algorithms. Pick a problem and an algorithm, tune its
parameters, and watch it search the landscape in real time. The algorithms are written in
**Python with NumPy**. They run **in your browser through Pyodide** (WebAssembly, in a Web
Worker), so the site is fully static. The *same* Python package can also run behind a
**FastAPI** server that streams iterations over **Server-Sent Events**. The front end is
**Next.js / TypeScript**.

![Particle swarm converging on Rastrigin](docs/live.png)

## Features

* **5 algorithms**, all vectorised with NumPy and reproducible with a seed:
  random search (Monte Carlo), hill climbing, simulated annealing, particle swarm
  optimisation (PSO) and differential evolution (DE/rand/1/bin).
* **6 problems**: Rastrigin, Ackley, Himmelblau, Rosenbrock, Sphere, and a
  **constrained 4-D engineering problem** (pressure-vessel design cost, constraints
  handled by penalty). For more than 2 dimensions the map shows a 2-D slice through
  the best point; pick the axes.
* **Live view**: objective heatmap (log colour scale), the population at each
  iteration, the best-so-far point and its trajectory, and a log-scale convergence curve.
* **Compare mode**: runs every algorithm over N seeds and plots mean convergence
  against *objective evaluations*, the fair x-axis because algorithms spend very
  different numbers of evaluations per iteration. The table shows mean ± std, best and
  success rate.

![Comparison on Rastrigin over 10 seeds](docs/compare.png)

On Rastrigin (100 iterations, 10 seeds), PSO and differential evolution reach the global
optimum in every run, while hill climbing (20 %) and simulated annealing (10 %) get trapped
in local minima. On the pressure-vessel problem, differential evolution finds the same
feasible design (cost 6,474.9) from every seed tried.

## Architecture

```
Next.js (React, TypeScript, Tailwind, Chart.js, <canvas>)
   │  src/lib/engine.ts — one interface, two interchangeable engines
   ├──────────────────────────────┐
   ▼ default                      ▼ when NEXT_PUBLIC_API_URL is set
Web Worker + Pyodide            FastAPI (SSE stream, /api/compare, /api/problems/{name}/grid)
   │  (Python 3.12 + NumPy        │
   │   compiled to WebAssembly)   │
   └──────────────┬───────────────┘
                  ▼
   metaheuristics/  (one Python package, shipped to the browser at build time)
     ├── problems.py     vectorised objectives, bounds, constraints, grid slices
     ├── algorithms.py   optimizers as generators: steps() yields the state per iteration
     └── service.py      catalogue, validation, run/compare (transport-independent)
```

Every optimizer is a Python generator, so the same code powers the browser engine, the SSE
stream, the comparison mode and the tests. Both engines give identical results for the same
seed. The test suite also runs under Pyodide's Python 3.12 / NumPy 1.26 combination.

## Run it

```bash
npm install && npm run dev       # → http://localhost:3000, Python runs in the browser, no server needed
```

With the FastAPI server instead:

```bash
docker compose up --build        # → http://localhost:3000 (API on :8000, docs at /api/docs)
# or: pip install -r requirements-dev.txt && uvicorn main:app --app-dir src/api --reload
#     NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

**Deploying:** import the repo in Vercel with the default Next.js settings and no environment
variables. The site is static and the algorithms run client-side. The first visit downloads
Pyodide + NumPy from the jsDelivr CDN (~10 MB, cached afterwards). To use the server engine
instead, deploy `api.Dockerfile` (set `CORS_ORIGINS` to the site URL) and set
`NEXT_PUBLIC_API_URL` in Vercel.

## Tests

```bash
pytest                              # 31 tests: bounds, monotone best-so-far, seeding, convergence,
                                    # constraint feasibility, service layer, SSE stream, validation
npm run typecheck && npm run lint
```
