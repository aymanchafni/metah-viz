"""Benchmark problems. Every objective is vectorised: it takes an (n, d) array and
returns n values, so a whole population is evaluated in one NumPy call."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

Objective = Callable[[np.ndarray], np.ndarray]


@dataclass(frozen=True)
class Problem:
    name: str
    label: str
    description: str
    objective: Objective
    bounds: np.ndarray                                  # shape (d, 2)
    optimum: Optional[float] = None                     # best known value
    constraints: Optional[Callable[[np.ndarray], np.ndarray]] = None  # (n, k) array, feasible iff <= 0
    penalty: float = 1e6
    axis_labels: tuple = field(default=())

    @property
    def dim(self) -> int:
        return len(self.bounds)

    def violation(self, x: np.ndarray) -> np.ndarray:
        if self.constraints is None:
            return np.zeros(len(x))
        return np.maximum(self.constraints(x), 0).sum(axis=1)

    def evaluate(self, x: np.ndarray) -> np.ndarray:
        """Objective + static penalty for constraint violations (what optimizers minimise)."""
        x = np.atleast_2d(x)
        return self.objective(x) + self.penalty * self.violation(x)

    def to_dict(self) -> dict:
        return {
            "name": self.name, "label": self.label, "description": self.description,
            "dim": self.dim, "bounds": self.bounds.tolist(), "optimum": self.optimum,
            "constrained": self.constraints is not None,
            "axis_labels": list(self.axis_labels) or [f"x{i + 1}" for i in range(self.dim)],
        }


def _sphere(x):
    return (x ** 2).sum(axis=1)


def _rastrigin(x):
    return 10 * x.shape[1] + (x ** 2 - 10 * np.cos(2 * np.pi * x)).sum(axis=1)


def _ackley(x):
    d = x.shape[1]
    return (-20 * np.exp(-0.2 * np.sqrt((x ** 2).sum(axis=1) / d))
            - np.exp(np.cos(2 * np.pi * x).sum(axis=1) / d) + 20 + np.e)


def _rosenbrock(x):
    return (100 * (x[:, 1:] - x[:, :-1] ** 2) ** 2 + (1 - x[:, :-1]) ** 2).sum(axis=1)


def _himmelblau(x):
    return (x[:, 0] ** 2 + x[:, 1] - 11) ** 2 + (x[:, 0] + x[:, 1] ** 2 - 7) ** 2


# Pressure-vessel design (cost of material, forming and welding), as formulated in the
# metaheuristics coursework: thicknesses are 0.625 * x1 and 0.625 * x2, radius x3, length x4.
def _pressure_vessel(x):
    ts, th, r, length = 0.625 * x[:, 0], 0.625 * x[:, 1], x[:, 2], x[:, 3]
    return 0.6224 * ts * r * length + 1.7781 * th * r ** 2 + 3.1661 * ts ** 2 * length + 19.84 * ts ** 2 * r


def _pressure_vessel_constraints(x):
    ts, th, r, length = 0.625 * x[:, 0], 0.625 * x[:, 1], x[:, 2], x[:, 3]
    return np.column_stack([
        0.0193 * r - ts,                                                   # shell thickness
        0.00954 * r - th,                                                  # head thickness
        1_296_000 - np.pi * r ** 2 * length - 4 / 3 * np.pi * r ** 3,      # minimum volume
    ])


PROBLEMS: dict[str, Problem] = {p.name: p for p in [
    Problem("rastrigin", "Rastrigin", "Highly multimodal: a regular grid of local minima.",
            _rastrigin, np.array([[-5.12, 5.12]] * 2), 0.0),
    Problem("ackley", "Ackley", "Nearly flat outer region with a deep central funnel.",
            _ackley, np.array([[-5.0, 5.0]] * 2), 0.0),
    Problem("himmelblau", "Himmelblau", "Four identical global minima.",
            _himmelblau, np.array([[-5.0, 5.0]] * 2), 0.0),
    Problem("rosenbrock", "Rosenbrock", "Narrow curved valley: easy to find, hard to follow.",
            _rosenbrock, np.array([[-2.0, 2.0], [-1.0, 3.0]]), 0.0),
    Problem("sphere", "Sphere", "Convex bowl: a sanity check every method should solve.",
            _sphere, np.array([[-5.0, 5.0]] * 2), 0.0),
    Problem("pressure_vessel", "Pressure vessel design (4-D, constrained)",
            "Minimise the manufacturing cost of a cylindrical vessel under thickness and volume constraints.",
            _pressure_vessel, np.array([[1, 99], [1, 99], [10, 200], [10, 240]], dtype=float), None,
            constraints=_pressure_vessel_constraints,
            axis_labels=("x1 (shell)", "x2 (head)", "x3 (radius)", "x4 (length)")),
]}


def grid(problem: Problem, n: int = 80, dims=(0, 1), fixed: Optional[np.ndarray] = None) -> dict:
    """Objective values on an n x n grid over two dimensions (others held at `fixed`)."""
    i, j = dims
    xs = np.linspace(*problem.bounds[i], n)
    ys = np.linspace(*problem.bounds[j], n)
    base = fixed if fixed is not None else problem.bounds.mean(axis=1)
    pts = np.tile(base, (n * n, 1)).astype(float)
    gx, gy = np.meshgrid(xs, ys)
    pts[:, i], pts[:, j] = gx.ravel(), gy.ravel()
    z = problem.evaluate(pts).reshape(n, n)
    return {"x": xs.tolist(), "y": ys.tolist(), "z": z.tolist()}
