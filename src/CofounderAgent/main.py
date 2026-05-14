"""CofounderAgent — Joseph's personal cofounder assistant.

v3 architecture: pure reasoning container. The LLM sees all tool schemas and
emits tool_calls, but this container does NOT execute them. Execution happens
in the Node backend, which drives the ReAct loop.

Benefits:
- The backend controls approval gating, sandboxing, and audit logging.
- The backend can execute tools that need filesystem / network access.
- Loop state (plan → act → observe → replan) lives in the backend.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
import sys
from pathlib import Path
from typing import Dict, List, Tuple

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, MessagesState, StateGraph
from typing_extensions import Literal

from azure.ai.agentserver.langgraph import from_langgraph
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.monitor.opentelemetry import configure_azure_monitor

from health_server import mark_error, mark_ready, start_health_server, stop_health_server
from model_routing import (
    DeploymentSpec,
    PERSONA_TO_TASK,
    Persona,
    ROUTES,
    TaskKind,
    resolve_route_for_task,
)
from project_context import gather_project_context, gather_git_summary
from settings import configure_logging, get_settings

logger = logging.getLogger(__name__)

load_dotenv()
_settings = get_settings()
configure_logging(level=_settings.log_level, json_logs=_settings.json_logs)

if os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    configure_azure_monitor(enable_live_metrics=True, logger_name="__main__")

# ---------------------------------------------------------------------------
# Persona prompts
# ---------------------------------------------------------------------------

PROMPTS_DIR = Path(__file__).parent / "prompts"

PERSONA_FILES: Dict[Persona, str] = {
    "orchestrator":   "orchestrator.prompt.md",
    "code_assistant": "code-assistant.prompt.md",
    "brand_designer": "brand-designer.prompt.md",
    "ops":            "ops-agent.prompt.md",
    "vision":         "vision-agent.prompt.md",
}


def _load_prompt(persona: Persona) -> str:
    path = PROMPTS_DIR / PERSONA_FILES[persona]
    if not path.is_file():
        logger.warning("Persona prompt file missing: %s", path)
        return f"You are the {persona} persona of the CofounderAgent."
    return path.read_text(encoding="utf-8")


PERSONA_PROMPTS: Dict[Persona, str] = {p: _load_prompt(p) for p in PERSONA_FILES}

_project_ctx = gather_project_context()
_git_ctx = gather_git_summary()
for _p in ("orchestrator", "code_assistant"):
    if _project_ctx:
        PERSONA_PROMPTS[_p] = PERSONA_PROMPTS[_p] + "\n" + _project_ctx
    if _git_ctx:
        PERSONA_PROMPTS[_p] = PERSONA_PROMPTS[_p] + _git_ctx

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

PERSONA_PREFIX_RE = re.compile(r"^\s*\[persona:([a-z_]+)\]\s*", re.IGNORECASE)
TASK_PREFIX_RE = re.compile(r"^\s*\[task:([a-z_]+)\]\s*", re.IGNORECASE)
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _sanitize(text: str) -> str:
    text = _CONTROL_CHAR_RE.sub("", text)
    return text[: _settings.max_message_chars]


def parse_persona(text: str) -> Tuple[Persona, str]:
    m = PERSONA_PREFIX_RE.match(text)
    if not m:
        return "orchestrator", text
    name = m.group(1).lower()
    if name not in _settings.parsed_persona_allowlist():
        logger.warning("Rejected unknown persona '%s', falling back to orchestrator", name)
        return "orchestrator", text
    return name, text[m.end() :]


def parse_task(text: str, fallback: TaskKind) -> Tuple[TaskKind, str]:
    m = TASK_PREFIX_RE.match(text)
    if not m:
        return fallback, text
    name = m.group(1).lower()
    if name not in ROUTES:
        logger.warning("Rejected unknown task '%s', falling back to %s", name, fallback)
        return fallback, text
    return name, text[m.end() :]


# ---------------------------------------------------------------------------
# LLM factory
# ---------------------------------------------------------------------------


def _credential():
    if _settings.local_dev_mode or _settings.mock_azure_credentials:
        logger.info("Using mock credential path (local dev)")
    return DefaultAzureCredential()


def _make_chat_llm(spec: DeploymentSpec):
    if spec.family != "azure_openai":
        raise ValueError(f"Cannot build chat LLM for non-chat family: {spec.family}")

    token_provider = get_bearer_token_provider(
        _credential(), "https://cognitiveservices.azure.com/.default"
    )

    kwargs = dict(
        model=spec.deployment,
        model_provider="azure_openai",
        azure_ad_token_provider=token_provider,
        temperature=0.2,
    )
    if spec.use_max_completion_tokens:
        kwargs["model_kwargs"] = {"max_completion_tokens": None}

    return init_chat_model(**kwargs)


_LLM_CACHE: Dict[str, object] = {}


def llm_for_task(persona: Persona, task: TaskKind):
    spec = resolve_route_for_task(task)
    if spec.deployment not in _LLM_CACHE:
        logger.info(
            "Building chat LLM: persona=%s task=%s deployment=%s",
            persona, task, spec.deployment,
        )
        _LLM_CACHE[spec.deployment] = _make_chat_llm(spec)
    return _LLM_CACHE[spec.deployment]


# ---------------------------------------------------------------------------
# Tool schemas (for LLM to emit; NOT executed here)
# ---------------------------------------------------------------------------

@tool
def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b


@tool
def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b


@tool
def read_file(path: str) -> str:
    """Read a text file at path (relative to repo root)."""
    return f"[DELEGATED] read_file({path})"


@tool
def list_directory(path: str = ".") -> str:
    """List files and directories at path."""
    return f"[DELEGATED] list_directory({path})"


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file. DESTRUCTIVE — requires approval."""
    return f"[DELEGATED] write_file({path})"


@tool
def search_replace(path: str, search: str, replace: str) -> str:
    """Replace first occurrence of search with replace. DESTRUCTIVE."""
    return f"[DELEGATED] search_replace({path})"


@tool
def run_command(command: str, cwd: str = ".") -> str:
    """Run a shell command. REQUIRES APPROVAL."""
    return f"[DELEGATED] run_command({command})"


@tool
def generate_image(prompt: str, quality: str = "auto", size: str = "auto") -> str:
    """Generate an image from a text prompt. Returns a base64 data URL."""
    return f"[DELEGATED] generate_image({prompt})"


@tool
def fetch_url(url: str, max_chars: int = 8000) -> str:
    """Fetch and return cleaned text from a URL."""
    return f"[DELEGATED] fetch_url({url})"


@tool
def grep(pattern: str, path: str = ".", max_results: int = 50) -> str:
    """Search code for pattern using ripgrep/grep."""
    return f"[DELEGATED] grep({pattern})"


@tool
def git_status(cwd: str = ".") -> str:
    """Run git status --short."""
    return f"[DELEGATED] git_status({cwd})"


@tool
def git_diff(cwd: str = ".", target: str = "HEAD") -> str:
    """Run git diff against target."""
    return f"[DELEGATED] git_diff({cwd}, {target})"


TOOLS = [
    add, multiply, read_file, list_directory, write_file, search_replace,
    run_command, generate_image, fetch_url, grep, git_status, git_diff,
]


# ---------------------------------------------------------------------------
# Graph (NO tool_node — backend drives execution)
# ---------------------------------------------------------------------------


def llm_call(state: MessagesState):
    persona: Persona = "orchestrator"
    task: TaskKind = PERSONA_TO_TASK[persona]
    messages = list(state["messages"])

    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if getattr(msg, "type", None) == "human":
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            text = _sanitize(text)
            p, cleaned = parse_persona(text)
            persona = p
            task, cleaned = parse_task(cleaned, PERSONA_TO_TASK[persona])
            if cleaned != text:
                msg.content = cleaned
            break

    messages_without_system = [
        m for m in messages if not isinstance(m, SystemMessage)
    ]

    llm = llm_for_task(persona, task).bind_tools(TOOLS)
    system_prompt = PERSONA_PROMPTS[persona]
    return {
        "messages": [
            llm.invoke([SystemMessage(content=system_prompt), *messages_without_system])
        ]
    }


def build_agent():
    builder = StateGraph(MessagesState)
    builder.add_node("llm_call", llm_call)
    builder.add_edge(START, "llm_call")
    builder.add_edge("llm_call", END)
    return builder.compile()


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

_shutdown_event = asyncio.Event()


def _handle_signal(sig: int) -> None:
    logger.info("Received signal %s, initiating graceful shutdown…", sig)
    _shutdown_event.set()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def _main():
    if _settings.enable_health_server:
        await start_health_server(host=_settings.host, port=_settings.health_port)

    try:
        agent = build_agent()
    except Exception:
        logger.exception("Failed to build agent graph")
        mark_error("agent_build_failed")
        raise

    mark_ready()

    adapter = from_langgraph(agent)
    loop = asyncio.get_running_loop()

    def _run_adapter():
        try:
            adapter.run()
        except Exception:
            logger.exception("Adapter encountered an error")
            raise

    adapter_task = loop.run_in_executor(None, _run_adapter)
    shutdown_task = asyncio.create_task(_shutdown_event.wait())
    done, pending = await asyncio.wait(
        [adapter_task, shutdown_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for t in pending:
        t.cancel()

    if _settings.enable_health_server:
        await stop_health_server()

    for t in done:
        if t is adapter_task:
            await t


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda s, f: _handle_signal(s))
    signal.signal(signal.SIGINT, lambda s, f: _handle_signal(s))
    try:
        asyncio.run(_main())
    except Exception:
        logger.exception("CofounderAgent fatal error")
        sys.exit(1)
