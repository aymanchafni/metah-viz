"""Metah-Viz API: runs metaheuristics and streams every iteration to the browser (SSE).

    uvicorn main:app --app-dir src/api --reload
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from metaheuristics import ALGORITHMS, PROBLEMS, grid

MAX_ITERATIONS = 2000

app = FastAPI(title="Metah-Viz API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def get_problem(name: str):
    if name not in PROBLEMS:
        raise HTTPException(404, f"Unknown problem '{name}'. Options: {sorted(PROBLEMS)}")
    return PROBLEMS[name]


def make_optimizer(algorithm: str, problem, seed, params_json: str | None):
    if algorithm not in ALGORITHMS:
        raise HTTPException(404, f"Unknown algorithm '{algorithm}'. Options: {sorted(ALGORITHMS)}")
    cls = ALGORITHMS[algorithm]
    try:
        params = json.loads(params_json) if params_json else {}
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"params must be JSON: {e}") from e
    unknown = set(params) - set(cls.params)
    if unknown:
        raise HTTPException(422, f"Unknown parameters for {algorithm}: {sorted(unknown)}")
    for name, value in params.items():
        _, lo, hi, _ = cls.params[name]
        if not (lo <= value <= hi):
            raise HTTPException(422, f"{name} must be within [{lo}, {hi}]")
    return cls(problem, seed=seed, **params)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/problems")
def list_problems():
    return [p.to_dict() for p in PROBLEMS.values()]


@app.get("/api/algorithms")
def list_algorithms():
    return [cls.describe() for cls in ALGORITHMS.values()]


@app.get("/api/problems/{name}/grid")
def problem_grid(
    name: str,
    n: int = Query(80, ge=10, le=200),
    dims: str = Query("0,1", description="two dimension indexes, e.g. '2,3'"),
    fixed: str | None = Query(None, description="comma-separated values for the other dimensions"),
):
    problem = get_problem(name)
    try:
        i, j = (int(v) for v in dims.split(","))
        base = np.array([float(v) for v in fixed.split(",")]) if fixed else None
    except ValueError as e:
        raise HTTPException(422, "dims must be 'i,j' and fixed a list of numbers") from e
    if not (0 <= i < problem.dim and 0 <= j < problem.dim and i != j):
        raise HTTPException(422, f"dims must be two distinct indexes in [0, {problem.dim - 1}]")
    if base is not None and len(base) != problem.dim:
        raise HTTPException(422, f"fixed must have {problem.dim} values")
    return grid(problem, n, (i, j), base)


@app.get("/api/run")
async def run(
    request: Request,
    problem: str,
    algorithm: str,
    iterations: int = Query(150, ge=1, le=MAX_ITERATIONS),
    seed: int | None = None,
    params: str | None = Query(None, description='JSON object, e.g. {"particles": 40}'),
    delay_ms: int = Query(50, ge=0, le=2000, description="pause between iterations (animation speed)"),
):
    """Server-sent events: one `data:` message per iteration, then `event: done`."""
    opt = make_optimizer(algorithm, get_problem(problem), seed, params)

    async def events() -> AsyncIterator[str]:
        for state in opt.steps(iterations):
            if await request.is_disconnected():   # user pressed Stop / closed the tab
                return
            yield f"data: {json.dumps(state.to_dict())}\n\n"
            await asyncio.sleep(delay_ms / 1000)
        summary = {"best_f": opt.best_f, "best_x": opt.best_x.tolist(), "evaluations": opt.evaluations}
        yield f"event: done\ndata: {json.dumps(summary)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/compare")
def compare(
    problem: str,
    iterations: int = Query(150, ge=1, le=500),
    runs: int = Query(10, ge=1, le=30),
):
    """Run every algorithm `runs` times (different seeds) with default parameters.

    Returns the mean best-so-far curve per algorithm *as a function of objective evaluations*
    (the fair x-axis: algorithms spend very different numbers of evaluations per iteration),
    plus summary statistics of the final result.
    """
    prob = get_problem(problem)
    results = []
    for key, cls in ALGORITHMS.items():
        finals, curves, evals = [], [], []
        for seed in range(runs):
            opt = cls(prob, seed=seed)
            curve = [(s.evaluations, s.best_f) for s in opt.steps(iterations)]
            finals.append(opt.best_f)
            evals.append(opt.evaluations)
            curves.append(curve)
        # resample every run onto a common evaluation grid, then average
        budget = min(e for e in evals)
        xs = np.linspace(1, budget, 60)
        ys = np.mean([np.interp(xs, *zip(*c, strict=False)) for c in curves], axis=0)
        finals = np.array(finals)
        gap = (finals - prob.optimum) if prob.optimum is not None else None
        results.append({
            "key": key, "label": cls.label,
            "curve": {"evaluations": xs.round().tolist(), "best_f": ys.tolist()},
            "mean": float(finals.mean()), "std": float(finals.std()),
            "best": float(finals.min()), "worst": float(finals.max()),
            "evaluations": int(np.mean(evals)),
            "success_rate": float((gap < 1e-2).mean()) if gap is not None else None,
        })
    return {"problem": prob.to_dict(), "iterations": iterations, "runs": runs, "results": results}
