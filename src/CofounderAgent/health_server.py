"""Standalone ASGI health-probe server for the hosted agent container.

Runs on a separate port so Kubernetes / Azure Container Apps liveness and
readiness probes don't hit the main agent graph (which may be busy or
expensive to invoke).
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Optional

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

logger = logging.getLogger(__name__)

# Shared state filled by main.py once the graph is built.
_agent_ready: bool = False
_agent_build_error: Optional[str] = None


def mark_ready() -> None:
    global _agent_ready
    _agent_ready = True
    logger.info("Health server: agent marked ready")


def mark_error(msg: str) -> None:
    global _agent_build_error
    _agent_build_error = msg
    logger.error("Health server: agent build error recorded: %s", msg)


async def _healthz(request):
    """Liveness probe — always returns 200 if the process is up."""
    return JSONResponse({"status": "alive", "pid": __import__("os").getpid()})


async def _readyz(request):
    """Readiness probe — 200 only after the LangGraph agent compiled OK."""
    if _agent_ready:
        return JSONResponse({"status": "ready", "agent": "CofounderAgent"})
    if _agent_build_error:
        return JSONResponse(
            {"status": "not_ready", "reason": _agent_build_error},
            status_code=503,
        )
    return JSONResponse(
        {"status": "starting", "reason": "agent not compiled yet"},
        status_code=503,
    )


async def _metrics(request):
    """Minimal Prometheus-style metrics (static for now)."""
    lines = [
        "# HELP cofounder_agent_ready Whether the agent is ready",
        "# TYPE cofounder_agent_ready gauge",
        f'cofounder_agent_ready{{agent="CofounderAgent"}} {1 if _agent_ready else 0}',
    ]
    return JSONResponse({"ready": _agent_ready, "build_error": _agent_build_error})


app = Starlette(
    routes=[
        Route("/healthz", _healthz),
        Route("/readyz", _readyz),
        Route("/metrics", _metrics),
    ],
)

_server_task: Optional[asyncio.Task] = None


async def start_health_server(host: str = "0.0.0.0", port: int = 8080):
    import uvicorn

    config = uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    global _server_task
    _server_task = asyncio.create_task(server.serve())
    logger.info("Health server started on http://%s:%s", host, port)


async def stop_health_server():
    global _server_task
    if _server_task:
        _server_task.cancel()
        try:
            await _server_task
        except asyncio.CancelledError:
            pass
        logger.info("Health server stopped")
