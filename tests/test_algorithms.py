import numpy as np
import pytest
from metaheuristics import ALGORITHMS, PROBLEMS, grid

ALGOS = list(ALGORITHMS)


@pytest.mark.parametrize("key", ALGOS)
def test_population_stays_within_bounds(key):
    problem = PROBLEMS["rastrigin"]
    for state in ALGORITHMS[key](problem, seed=0).steps(40):
        assert (state.population >= problem.bounds[:, 0] - 1e-12).all()
        assert (state.population <= problem.bounds[:, 1] + 1e-12).all()


@pytest.mark.parametrize("key", ALGOS)
def test_best_so_far_never_gets_worse(key):
    values = [s.best_f for s in ALGORITHMS[key](PROBLEMS["ackley"], seed=1).steps(60)]
    assert all(b <= a for a, b in zip(values, values[1:], strict=False))


@pytest.mark.parametrize("key", ALGOS)
def test_runs_are_reproducible_with_a_seed(key):
    run = lambda: [s.best_f for s in ALGORITHMS[key](PROBLEMS["himmelblau"], seed=42).steps(20)]  # noqa: E731
    assert run() == run()


@pytest.mark.parametrize("key, tol", [("pso", 1e-3), ("de", 1e-3), ("annealing", 0.5), ("hill", 0.5)])
def test_population_methods_solve_the_sphere(key, tol):
    opt = ALGORITHMS[key](PROBLEMS["sphere"], seed=0)
    for _ in opt.steps(200):
        pass
    assert opt.best_f < tol


def test_pso_beats_random_search_on_rastrigin():
    def final(key):
        scores = []
        for seed in range(5):
            opt = ALGORITHMS[key](PROBLEMS["rastrigin"], seed=seed)
            for _ in opt.steps(100):
                pass
            scores.append(opt.best_f)
        return np.mean(scores)

    assert final("pso") < final("random")


def test_pressure_vessel_solution_is_feasible():
    problem = PROBLEMS["pressure_vessel"]
    opt = ALGORITHMS["de"](problem, seed=0)
    for _ in opt.steps(300):
        pass
    assert problem.violation(opt.best_x[None])[0] == pytest.approx(0, abs=1e-6)
    assert opt.best_f < 1e5   # feasible designs cost far less than the 1e6 penalty


def test_grid_shape_and_values():
    g = grid(PROBLEMS["sphere"], n=11)
    z = np.array(g["z"])
    assert z.shape == (11, 11)
    assert z.min() == pytest.approx(0.0)   # centre of the [-5, 5] grid
