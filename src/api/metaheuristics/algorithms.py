"""Metaheuristics as generators: each `steps()` call yields the state after every
iteration, which the API streams to the browser.

All algorithms minimise `problem.evaluate` (objective + constraint penalty), keep their
population inside the bounds, and are reproducible through `seed`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import numpy as np

from .problems import Problem


@dataclass
class State:
    iteration: int
    population: np.ndarray     # (n, d) points evaluated this iteration
    best_x: np.ndarray
    best_f: float
    evaluations: int

    def to_dict(self, max_points: int = 200) -> dict:
        return {
            "iteration": self.iteration,
            "population": self.population[:max_points].round(6).tolist(),
            "best_x": self.best_x.round(6).tolist(),
            "best_f": float(self.best_f),
            "evaluations": self.evaluations,
        }


class Optimizer:
    key = ""
    label = ""
    description = ""
    params: dict = {}          # name -> (default, min, max, help)

    def __init__(self, problem: Problem, seed: int | None = None, **params):
        self.problem = problem
        self.rng = np.random.default_rng(seed)
        self.p = {k: type(v[0])(params.get(k, v[0])) for k, v in self.params.items()}
        self.lo, self.hi = problem.bounds[:, 0], problem.bounds[:, 1]
        self.span = self.hi - self.lo
        self.evaluations = 0
        self.best_x: np.ndarray | None = None
        self.best_f = np.inf

    # helpers -----------------------------------------------------------
    def uniform(self, n: int) -> np.ndarray:
        return self.lo + self.rng.random((n, self.problem.dim)) * self.span

    def clip(self, x: np.ndarray) -> np.ndarray:
        return np.clip(x, self.lo, self.hi)

    def evaluate(self, x: np.ndarray) -> np.ndarray:
        f = self.problem.evaluate(x)
        self.evaluations += len(x)
        i = int(np.argmin(f))
        if f[i] < self.best_f:
            self.best_f, self.best_x = float(f[i]), x[i].copy()
        return f

    def state(self, iteration: int, population: np.ndarray) -> State:
        return State(iteration, population, self.best_x, self.best_f, self.evaluations)

    def steps(self, iterations: int) -> Iterator[State]:
        raise NotImplementedError

    @classmethod
    def describe(cls) -> dict:
        return {
            "key": cls.key, "label": cls.label, "description": cls.description,
            "params": [{"name": k, "default": v[0], "min": v[1], "max": v[2], "help": v[3]}
                       for k, v in cls.params.items()],
        }


class RandomSearch(Optimizer):
    key = "random"
    label = "Random search (Monte Carlo)"
    description = "Samples points uniformly at random and keeps the best. The baseline to beat."
    params = {"samples": (30, 1, 500, "points sampled per iteration")}

    def steps(self, iterations):
        for t in range(iterations):
            pop = self.uniform(self.p["samples"])
            self.evaluate(pop)
            yield self.state(t, pop)


class HillClimbing(Optimizer):
    key = "hill"
    label = "Hill climbing"
    description = "Moves to the best of a few Gaussian neighbours when it improves. Fast, but gets stuck."
    params = {
        "neighbours": (20, 1, 200, "neighbours tried per iteration"),
        "step": (0.05, 0.001, 1.0, "neighbour std-dev, as a fraction of the search range"),
    }

    def steps(self, iterations):
        x = self.uniform(1)[0]
        fx = self.evaluate(x[None])[0]
        for t in range(iterations):
            cand = self.clip(x + self.rng.normal(0, self.p["step"], (self.p["neighbours"], len(x))) * self.span)
            f = self.evaluate(cand)
            i = int(np.argmin(f))
            if f[i] < fx:
                x, fx = cand[i], f[i]
            yield self.state(t, cand)


class SimulatedAnnealing(Optimizer):
    key = "annealing"
    label = "Simulated annealing"
    description = ("Accepts worse moves with probability exp(-Δ/T) while the temperature T cools, "
                   "so it can escape local minima early on.")
    params = {
        "t0": (10.0, 0.001, 1e6, "initial temperature"),
        "cooling": (0.97, 0.5, 0.9999, "geometric cooling factor per iteration"),
        "step": (0.1, 0.001, 1.0, "move std-dev, as a fraction of the search range"),
        "moves": (10, 1, 200, "moves attempted per iteration"),
    }

    def steps(self, iterations):
        x = self.uniform(1)[0]
        fx = self.evaluate(x[None])[0]
        temp = self.p["t0"]
        for t in range(iterations):
            tried = []
            for _ in range(self.p["moves"]):
                # Step size shrinks with temperature: wide exploration first, fine tuning later.
                scale = self.p["step"] * max(temp / self.p["t0"], 0.01)
                cand = self.clip(x + self.rng.normal(0, scale, len(x)) * self.span)
                fc = self.evaluate(cand[None])[0]
                tried.append(cand)
                delta = fc - fx
                if delta < 0 or self.rng.random() < np.exp(-delta / max(temp, 1e-12)):
                    x, fx = cand, fc
            temp *= self.p["cooling"]
            yield self.state(t, np.array(tried))


class ParticleSwarm(Optimizer):
    key = "pso"
    label = "Particle swarm (PSO)"
    description = ("Particles fly through the space, pulled towards their own best position "
                   "(cognitive term) and the swarm's best (social term).")
    params = {
        "particles": (30, 2, 500, "swarm size"),
        "inertia": (0.72, 0.0, 1.2, "velocity inertia w"),
        "c1": (1.49, 0.0, 4.0, "cognitive coefficient"),
        "c2": (1.49, 0.0, 4.0, "social coefficient"),
    }

    def steps(self, iterations):
        n, d = self.p["particles"], self.problem.dim
        x = self.uniform(n)
        v = (self.rng.random((n, d)) - 0.5) * self.span * 0.2
        fx = self.evaluate(x)
        pbest, pbest_f = x.copy(), fx.copy()
        vmax = 0.2 * self.span
        for t in range(iterations):
            r1, r2 = self.rng.random((n, d)), self.rng.random((n, d))
            v = (self.p["inertia"] * v + self.p["c1"] * r1 * (pbest - x)
                 + self.p["c2"] * r2 * (self.best_x - x))
            v = np.clip(v, -vmax, vmax)
            x = self.clip(x + v)
            fx = self.evaluate(x)
            improved = fx < pbest_f
            pbest[improved], pbest_f[improved] = x[improved], fx[improved]
            yield self.state(t, x)


class DifferentialEvolution(Optimizer):
    key = "de"
    label = "Differential evolution"
    description = ("Builds trial points from scaled differences between population members "
                   "(DE/rand/1/bin) and keeps them when they are better.")
    params = {
        "population": (30, 4, 500, "population size"),
        "f": (0.7, 0.0, 2.0, "differential weight F"),
        "cr": (0.9, 0.0, 1.0, "crossover rate CR"),
    }

    def steps(self, iterations):
        n, d = self.p["population"], self.problem.dim
        pop = self.uniform(n)
        fit = self.evaluate(pop)
        idx = np.arange(n)
        for t in range(iterations):
            # three distinct partners per individual, all different from the individual itself
            partners = np.array([self.rng.choice(np.delete(idx, i), 3, replace=False) for i in idx])
            a, b, c = pop[partners[:, 0]], pop[partners[:, 1]], pop[partners[:, 2]]
            mutant = self.clip(a + self.p["f"] * (b - c))
            cross = self.rng.random((n, d)) < self.p["cr"]
            cross[idx, self.rng.integers(0, d, n)] = True   # at least one gene from the mutant
            trial = np.where(cross, mutant, pop)
            f_trial = self.evaluate(trial)
            better = f_trial < fit
            pop[better], fit[better] = trial[better], f_trial[better]
            yield self.state(t, pop.copy())


ALGORITHMS: dict[str, type[Optimizer]] = {
    cls.key: cls for cls in [RandomSearch, HillClimbing, SimulatedAnnealing, ParticleSwarm, DifferentialEvolution]
}
