"""Transport-independent operations used by both front ends of the engine:

* the FastAPI server (`main.py`, Server-Sent Events), and
* the in-browser engine (Pyodide in a Web Worker, see `src/workers/engine.worker.ts`).

Everything returns plain JSON-serialisable data; invalid input raises `ValueError`
(or `LookupError` for unknown names).
"""

from __future__ import annotations

from typing import Iterator, Optional

import numpy as np

from .algorithms import ALGORITHMS, Optimizer
from .problems import PROBLEMS, Problem, grid

MAX_ITERATIONS = 2000


def problems() -> list[dict]:
    return [p.to_dict() for p in PROBLEMS.values()]


def algorithms() -> list[dict]:
    return [cls.describe() for cls in ALGORITHMS.values()]


def get_problem(name: str) -> Problem:
    if name not in PROBLEMS:
        raise LookupError(f"Unknown problem '{name}'. Options: {sorted(PROBLEMS)}")
    return PROBLEMS[name]


def make_optimizer(algorithm: str, problem: str, seed: Optional[int], params: Optional[dict]) -> Optimizer:
    if algorithm not in ALGORITHMS:
        raise LookupError(f"Unknown algorithm '{algorithm}'. Options: {sorted(ALGORITHMS)}")
    cls = ALGORITHMS[algorithm]
    params = params or {}
    unknown = set(params) - set(cls.params)
    if unknown:
        raise ValueError(f"Unknown parameters for {algorithm}: {sorted(unknown)}")
    for name, value in params.items():
        _, lo, hi, _ = cls.params[name]
        if not (lo <= value <= hi):
            raise ValueError(f"{name} must be within [{lo}, {hi}]")
    return cls(get_problem(problem), seed=seed, **params)


def landscape(name: str, n: int = 80, dims: tuple[int, int] = (0, 1), fixed: Optional[list[float]] = None) -> dict:
    problem = get_problem(name)
    i, j = dims
    if not (0 <= i < problem.dim and 0 <= j < problem.dim and i != j):
        raise ValueError(f"dims must be two distinct indexes in [0, {problem.dim - 1}]")
    if fixed is not None and len(fixed) != problem.dim:
        raise ValueError(f"fixed must have {problem.dim} values")
    if not 10 <= n <= 200:
        raise ValueError("n must be within [10, 200]")
    return grid(problem, n, (i, j), np.array(fixed, dtype=float) if fixed is not None else None)


def run(optimizer: Optimizer, iterations: int) -> Iterator[dict]:
    """One JSON-ready state per iteration."""
    if not 1 <= iterations <= MAX_ITERATIONS:
        raise ValueError(f"iterations must be within [1, {MAX_ITERATIONS}]")
    for state in optimizer.steps(iterations):
        yield state.to_dict()


def summary(optimizer: Optimizer) -> dict:
    return {"best_f": optimizer.best_f, "best_x": optimizer.best_x.tolist(), "evaluations": optimizer.evaluations}


def compare(problem: str, iterations: int = 150, runs: int = 10) -> dict:
    """Run every algorithm `runs` times (seeds 0..runs-1) with default parameters.

    Returns the mean best-so-far curve per algorithm *as a function of objective evaluations*
    (the fair x-axis: algorithms spend very different numbers of evaluations per iteration),
    plus summary statistics of the final result.
    """
    if not 1 <= iterations <= 500 or not 1 <= runs <= 30:
        raise ValueError("iterations must be within [1, 500] and runs within [1, 30]")
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
        xs = np.linspace(1, min(evals), 60)
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
