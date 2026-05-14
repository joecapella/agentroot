"""CofounderAgent — Joseph's personal cofounder assistant.

Single hosted-agent container with multiple *personas* (orchestrator, code,
brand, ops, vision). Persona is chosen per turn from an optional
``[persona:<name>]`` prefix on the user message; defaults to ``orchestrator``.

Each persona picks its preferred Foundry deployment via ``model_routing``.
Models marked unavailable there fall through to the next preferred option, so
a deployment that ``api_not_supported``s today doesn't take the agent down —
it routes around it.

v1 tool surface is intentionally tiny (calculator-style demo tools) so this
container's behavior stays auditable. Real cofounder tools (open_url,
create_todo, ...) will arrive via Foundry OpenAPI tools, not by reaching out
from this code.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Dict, Tuple

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, MessagesState, StateGraph
from typing_extensions import Literal

from azure.ai.agentserver.langgraph import from_langgraph
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.monitor.opentelemetry import configure_azure_monitor

from model_routing import (
    DeploymentSpec,
    PERSONA_TO_TASK,
    Persona,
    ROUTES,
    TaskKind,
    resolve_route_for_task,
)

logger = logging.getLogger(__name__)

load_dotenv()

if os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    configure_azure_monitor(enable_live_metrics=True, logger_name="__main__")


# ---------------------------------------------------------------------------
# Persona prompts (loaded once at startup from the baked-in /prompts dir).
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

PERSONA_PREFIX_RE = re.compile(r"^\s*\[persona:([a-z_]+)\]\s*", re.IGNORECASE)
TASK_PREFIX_RE = re.compile(r"^\s*\[task:([a-z_]+)\]\s*", re.IGNORECASE)


def parse_persona(text: str) -> Tuple[Persona, str]:
    m = PERSONA_PREFIX_RE.match(text)
    if not m:
        return "orchestrator", text
    name = m.group(1).lower()
    if name not in PERSONA_FILES:
        return "orchestrator", text
    return name, text[m.end() :]


def parse_task(text: str, fallback: TaskKind) -> Tuple[TaskKind, str]:
    m = TASK_PREFIX_RE.match(text)
    if not m:
        return fallback, text
    name = m.group(1).lower()
    if name not in ROUTES:
        return fallback, text
    return name, text[m.end() :]


# ---------------------------------------------------------------------------
# LLM factory (per persona; one client cached per deployment).
# ---------------------------------------------------------------------------


def _credential():
    return DefaultAzureCredential()


def _make_chat_llm(spec: DeploymentSpec):
    """Construct an Azure-hosted chat model for ``spec``.

    All chat-family deployments on the ``plimsoll`` project currently route
    through the Azure OpenAI chat-completions surface (``family ==
    "azure_openai"``). When new deployment families need different invoke
    paths, add another branch here.
    """

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
    # gpt-5.5 et al. require ``max_completion_tokens`` instead of ``max_tokens``.
    # We don't actually cap here, but expose the knob so future code can.
    if spec.use_max_completion_tokens:
        kwargs["model_kwargs"] = {"max_completion_tokens": None}

    return init_chat_model(**kwargs)


# Build a chat client lazily, then cache it. Keyed by deployment name.
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
# Demo tools (retained while we wire OpenAPI tools in Phase 6).
# ---------------------------------------------------------------------------


@tool
def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b


@tool
def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b


TOOLS = [add, multiply]


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def llm_call(state: MessagesState):
    """Compose the LLM input for this turn.

    Two important behaviours (both fixes for Bug-3):

    1. We DROP any pre-existing ``SystemMessage`` entries from
       ``state["messages"]`` before prepending the current persona's prompt.
       Without this, every turn would re-stack a fresh system prompt on top
       of whatever a prior turn already prepended, producing quadratic
       system-message growth and silent token bloat.

    2. We compute persona PER TURN from the latest human message's
       ``[persona:...]`` tag (or default to ``orchestrator``). When the user
       switches persona mid-session, the next turn uses ONLY the new
       persona's system prompt — no leftover system instruction from the
       previous persona contaminates the call.
    """
    persona: Persona = "orchestrator"
    task: TaskKind = PERSONA_TO_TASK[persona]
    messages = list(state["messages"])

    # Find the most recent human message and strip any [persona:...] tag.
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if getattr(msg, "type", None) == "human":
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            p, cleaned = parse_persona(text)
            persona = p
            task, cleaned = parse_task(cleaned, PERSONA_TO_TASK[persona])
            if cleaned != text:
                msg.content = cleaned
            break

    # Drop any pre-existing SystemMessage so we don't stack prompts.
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


def tool_node(state: MessagesState):
    from langchain_core.messages import ToolMessage

    last = state["messages"][-1]
    tool_calls = getattr(last, "tool_calls", None) or []
    by_name = {t.name: t for t in TOOLS}
    results = []
    for call in tool_calls:
        name = call["name"]
        args = call.get("args", {})
        if name in by_name:
            try:
                output = by_name[name].invoke(args)
            except Exception as exc:  # noqa: BLE001
                output = f"tool {name} failed: {exc!r}"
        else:
            output = f"unknown tool: {name}"
        results.append(ToolMessage(content=str(output), tool_call_id=call["id"]))
    return {"messages": results}


def should_continue(state: MessagesState) -> Literal["Action", END]:
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "Action"
    return END


def build_agent():
    builder = StateGraph(MessagesState)
    builder.add_node("llm_call", llm_call)
    builder.add_node("environment", tool_node)
    builder.add_edge(START, "llm_call")
    builder.add_conditional_edges(
        "llm_call", should_continue, {"Action": "environment", END: END}
    )
    builder.add_edge("environment", "llm_call")
    return builder.compile()


if __name__ == "__main__":
    try:
        agent = build_agent()
        adapter = from_langgraph(agent)
        adapter.run()
    except Exception:
        logger.exception("CofounderAgent encountered an error while running")
        raise
