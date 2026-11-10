"""The service layer is what both engines call (FastAPI on the server, Pyodide in the browser)."""

import json

import pytest
from metaheuristics import service


def test_catalogue_is_json_serialisable():
    json.dumps(service.problems())
    json.dumps(service.algorithms())


def test_run_yields_json_states_and_summary():
    opt = service.make_optimizer("de", "sphere", seed=3, params={"population": 8})
    states = list(service.run(opt, 4))
    assert [s["iteration"] for s in states] == [0, 1, 2, 3]
    assert len(states[0]["population"]) == 8
    summary = service.summary(opt)
    assert summary["best_f"] == states[-1]["best_f"]
    json.dumps(states)
    json.dumps(summary)


def test_validation_errors():
    with pytest.raises(LookupError):
        service.make_optimizer("nope", "sphere", None, None)
    with pytest.raises(LookupError):
        service.get_problem("nope")
    with pytest.raises(ValueError, match="within"):
        service.make_optimizer("pso", "sphere", None, {"particles": 1})
    with pytest.raises(ValueError):
        list(service.run(service.make_optimizer("pso", "sphere", 0, None), 0))
    with pytest.raises(ValueError):
        service.landscape("pressure_vessel", dims=(0, 0))
    with pytest.raises(ValueError):
        service.landscape("pressure_vessel", fixed=[1, 2])


def test_landscape_accepts_lists_from_javascript():
    g = service.landscape("pressure_vessel", n=10, dims=[2, 3], fixed=[50, 50, 100, 100])
    assert len(g["z"]) == 10 and len(g["x"]) == 10
