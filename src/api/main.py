"""Metah-Viz API: runs metaheuristics and streams every iteration to the browser (SSE).

    uvicorn main:app --app-dir src/api --reload

The same operations run in the browser through Pyodide (see src/workers/engine.worker.ts);
this server is used when the front end is built with NEXT_PUBLIC_API_URL.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from metaheuristics import service

app = FastAPI(title="Metah-Viz API", version="1.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def call(fn, *args, **kwargs):
    """Map service errors to HTTP status codes."""
    try:
        return fn(*args, **kwargs)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/problems")
def list_problems():
    return service.problems()


@app.get("/api/algorithms")
def list_algorithms():
    return service.algorithms()


@app.get("/api/problems/{name}/grid")
def problem_grid(
    name: str,
    n: int = Query(80, ge=10, le=200),
    dims: str = Query("0,1", description="two dimension indexes, e.g. '2,3'"),
    fixed: str | None = Query(None, description="comma-separated values for the other dimensions"),
):
    try:
        i, j = (int(v) for v in dims.split(","))
        base = [float(v) for v in fixed.split(",")] if fixed else None
    except ValueError as e:
        raise HTTPException(422, "dims must be 'i,j' and fixed a list of numbers") from e
    return call(service.landscape, name, n, (i, j), base)


@app.get("/api/run")
async def run(
    request: Request,
    problem: str,
    algorithm: str,
    iterations: int = Query(150, ge=1, le=service.MAX_ITERATIONS),
    seed: int | None = None,
    params: str | None = Query(None, description='JSON object, e.g. {"particles": 40}'),
    delay_ms: int = Query(50, ge=0, le=2000, description="pause between iterations (animation speed)"),
):
    """Server-sent events: one `data:` message per iteration, then `event: done`."""
    try:
        parsed = json.loads(params) if params else {}
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"params must be JSON: {e}") from e
    opt = call(service.make_optimizer, algorithm, problem, seed, parsed)

    async def events() -> AsyncIterator[str]:
        for state in service.run(opt, iterations):
            if await request.is_disconnected():   # user pressed Stop / closed the tab
                return
            yield f"data: {json.dumps(state)}\n\n"
            await asyncio.sleep(delay_ms / 1000)
        yield f"event: done\ndata: {json.dumps(service.summary(opt))}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/compare")
def compare(
    problem: str,
    iterations: int = Query(150, ge=1, le=500),
    runs: int = Query(10, ge=1, le=30),
):
    """Every algorithm, `runs` seeds each, default parameters (see service.compare)."""
    return call(service.compare, problem, iterations, runs)
