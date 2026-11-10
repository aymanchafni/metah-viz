import json

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_catalogue_endpoints():
    problems = client.get("/api/problems").json()
    algorithms = client.get("/api/algorithms").json()
    assert {p["name"] for p in problems} >= {"rastrigin", "pressure_vessel"}
    assert {a["key"] for a in algorithms} == {"random", "hill", "annealing", "pso", "de"}


def test_run_streams_one_event_per_iteration_then_done():
    with client.stream("GET", "/api/run", params={
        "problem": "sphere", "algorithm": "pso", "iterations": 5, "seed": 1, "delay_ms": 0,
        "params": json.dumps({"particles": 10}),
    }) as resp:
        body = "".join(resp.iter_text())
    events = [e for e in body.split("\n\n") if e.strip()]
    data = [json.loads(e.removeprefix("data: ")) for e in events if e.startswith("data: ")]
    assert len(data) == 5
    assert len(data[0]["population"]) == 10
    assert events[-1].startswith("event: done")


def test_run_validates_inputs():
    assert client.get("/api/run", params={"problem": "nope", "algorithm": "pso"}).status_code == 404
    assert client.get("/api/run", params={"problem": "sphere", "algorithm": "pso",
                                          "params": json.dumps({"particles": 10_000})}).status_code == 422
    assert client.get("/api/run", params={"problem": "sphere", "algorithm": "pso",
                                          "params": json.dumps({"unknown": 1})}).status_code == 422


def test_grid_for_a_4d_problem_slice():
    resp = client.get("/api/problems/pressure_vessel/grid",
                      params={"n": 10, "dims": "2,3", "fixed": "50,50,100,100"})
    assert resp.status_code == 200
    assert len(resp.json()["z"]) == 10


def test_compare_summarises_every_algorithm():
    resp = client.get("/api/compare", params={"problem": "sphere", "iterations": 20, "runs": 2}).json()
    assert len(resp["results"]) == 5
    for r in resp["results"]:
        assert len(r["curve"]["best_f"]) == len(r["curve"]["evaluations"]) == 60
        assert r["best"] <= r["mean"] <= r["worst"]
