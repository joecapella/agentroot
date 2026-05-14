"""Logical model routing for CofounderAgent personas.

Maps logical model names (``gpt-5.5``, ``claude-opus-4-7``, etc.) to actual
Foundry deployment names and call-style metadata. Mirrors ``src/modelRouting.ts``
on the TS side — keep them in sync when adding a new TaskKind / logical model.

Verified against the ``plimsoll`` Foundry project on 2026-05-12. As of that
date:

- ``gpt-5.5``, ``gpt-image-2-1``, ``DeepSeek-V4-Flash``, ``Kimi-K2.6`` are
  reachable via the Azure OpenAI chat-completions surface.
- ``claude-opus-4-7`` and ``claude-sonnet-4-6`` deployments exist on the
  account but currently return ``api_not_supported`` on both
  ``/openai/deployments/.../chat/completions`` and
  ``/models/chat/completions``. They are marked ``unavailable`` here so the
  factory falls back automatically. Flip ``unavailable=False`` once their
  invoke path is fixed at the deployment side.
- ``gpt-4.1`` is deliberately not used as a default for any TaskKind per the
  user's preference (premium-only routing). It is still listed as a safety
  fallback the LLM factory can fall through to if every preferred model is
  unavailable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Literal, Optional


TaskKind = Literal[
    "deep_planning",
    "general_chat",
    "fast_brainstorm",
    "code_repo",
    "code_file",
    "brand_strategy",
    "copywriting",
    "personal_ops",
    "vision",
    "visual",
]


Persona = Literal["orchestrator", "code_assistant", "brand_designer", "ops", "vision"]


@dataclass(frozen=True)
class ModelRoute:
    default_model: str
    fallback: Optional[str] = None
    second_fallback: Optional[str] = None


# Premium-only routing per Joseph's 2026-05-12 preference. No gpt-4.1 defaults.
# Fallbacks are listed in priority order; the factory uses the first available.
ROUTES: Dict[TaskKind, ModelRoute] = {
    "deep_planning":   ModelRoute("gpt-5.5",            "claude-opus-4-7",   "claude-sonnet-4-6"),
    "general_chat":    ModelRoute("gpt-5.5",            "claude-sonnet-4-6", "deepseek-v4-flash"),
    "fast_brainstorm": ModelRoute("deepseek-v4-flash",  "claude-sonnet-4-6", "gpt-5.5"),
    "code_repo":       ModelRoute("claude-opus-4-7",    "gpt-5.5",           "claude-sonnet-4-6"),
    "code_file":       ModelRoute("claude-sonnet-4-6",  "claude-opus-4-7",   "gpt-5.5"),
    "brand_strategy":  ModelRoute("claude-opus-4-7",    "gpt-5.5",           "claude-sonnet-4-6"),
    "copywriting":     ModelRoute("claude-sonnet-4-6",  "claude-opus-4-7",   "gpt-5.5"),
    "personal_ops":    ModelRoute("claude-opus-4-7",    "gpt-5.5",           "claude-sonnet-4-6"),
    "vision":          ModelRoute("kimi-k2.6",          "gpt-5.5"),
    "visual":          ModelRoute("gpt-image-2",        None),  # image gen
}


@dataclass(frozen=True)
class DeploymentSpec:
    deployment: str
    # Family chooses the langchain provider/client to use:
    #  - "azure_openai": classic /openai/deployments/<name>/chat/completions
    #  - "image_gen":    image generation, not a chat client
    #  - "direct_openai": Node backend calls the API directly; container skips
    family: str
    # If True, the factory will skip this and try the fallback. Set False once
    # the underlying deployment is healthy on the Foundry account.
    unavailable: bool = False
    # Some newer GPT models require ``max_completion_tokens`` instead of
    # ``max_tokens``. We pass this hint through to the langchain client.
    use_max_completion_tokens: bool = False


# Logical → Deployment spec on the ``plimsoll`` Foundry project.
# Override the deployment name via env var
# ``MODEL_DEPLOYMENT_<logical with non-alnum→_>``.
LOGICAL_DEPLOYMENTS: Dict[str, DeploymentSpec] = {
    "gpt-5.5":           DeploymentSpec("gpt-5.5",            "azure_openai", use_max_completion_tokens=True),
    "gpt-4.1":           DeploymentSpec("gpt-4.1",            "azure_openai"),
    "claude-opus-4-7":   DeploymentSpec("claude-opus-4-7",    "azure_openai", unavailable=True),
    "claude-sonnet-4-6": DeploymentSpec("claude-sonnet-4-6",  "azure_openai", unavailable=True),
    "deepseek-v4-flash": DeploymentSpec("DeepSeek-V4-Flash",  "azure_openai"),
    "kimi-k2.6":         DeploymentSpec("Kimi-K2.6",          "azure_openai"),
    "gpt-image-2":       DeploymentSpec("gpt-image-2-1",      "image_gen"),
    # Direct providers are handled by the Node backend; keep them unavailable
    # in the container so they never get selected here.
    "gemini-pro":        DeploymentSpec("gemini-2.5-pro-preview-03-25",   "direct_openai", unavailable=True),
    "gemini-flash":      DeploymentSpec("gemini-2.5-flash-preview-04-17", "direct_openai", unavailable=True),
    "ollama-coder":      DeploymentSpec("qwen2.5-coder:7b",              "direct_openai", unavailable=True),
    "ollama-fast":       DeploymentSpec("llama3.2:3b",                   "direct_openai", unavailable=True),
    "ollama-deep":       DeploymentSpec("qwen2.5-coder:14b",             "direct_openai", unavailable=True),
}


# Each persona has a primary task kind used when nothing more specific is
# inferred from the message.
PERSONA_TO_TASK: Dict[Persona, TaskKind] = {
    "orchestrator":   "general_chat",
    "code_assistant": "code_file",
    "brand_designer": "brand_strategy",
    "ops":            "personal_ops",
    "vision":         "vision",
}


# Safety net: when every preferred logical model is unavailable, we still
# need *some* working chat model. ``gpt-5.5`` is the safe premium default.
LAST_RESORT_LOGICAL = os.getenv("LAST_RESORT_LOGICAL", "gpt-5.5")


def pick_model_for_task(task: TaskKind) -> ModelRoute:
    return ROUTES[task]


def _spec_for(logical: str) -> Optional[DeploymentSpec]:
    return LOGICAL_DEPLOYMENTS.get(logical)


def deployment_for_model(
    logical: str, fallback: str = "gpt-5.5"
) -> str:
    """Resolve logical → actual deployment name (string only).

    Env override ``MODEL_DEPLOYMENT_<logical-with-underscores>`` wins.
    Otherwise the static map is consulted, then the supplied fallback.
    """

    key = "MODEL_DEPLOYMENT_" + "".join(c if c.isalnum() else "_" for c in logical)
    env_val = os.getenv(key)
    if env_val:
        return env_val
    spec = _spec_for(logical)
    if spec:
        return spec.deployment
    return fallback


def resolve_available(logical: str) -> Optional[DeploymentSpec]:
    """Return the spec for ``logical`` if it's marked available, else None."""

    spec = _spec_for(logical)
    if spec is None or spec.unavailable:
        return None
    return spec


def resolve_route_for_task(task: TaskKind, *, chat_only: bool = True) -> DeploymentSpec:
    """Pick the first available DeploymentSpec for a task, walking fallbacks.

    When ``chat_only`` (the default), specs whose family is not
    ``azure_openai`` are skipped because ``_make_chat_llm`` cannot build a
    chat client from them. This protects against e.g. the ``visual`` route's
    ``gpt-image-2`` (family ``image_gen``) being returned for a chat turn —
    that combination was Bug-7/9: the container raised ``ValueError`` and
    the conversation 500'd.

    Falls back to ``LAST_RESORT_LOGICAL`` if nothing in the route works.
    Raises only if every option (including last resort) is unknown or
    non-chat — which would be a config bug, not a runtime condition.
    """

    def _ok(spec: Optional[DeploymentSpec]) -> bool:
        if spec is None:
            return False
        if chat_only and spec.family not in ("azure_openai", "direct_openai"):
            return False
        return True

    route = ROUTES[task]
    for logical in (route.default_model, route.fallback, route.second_fallback):
        if not logical:
            continue
        spec = resolve_available(logical)
        if _ok(spec):
            return spec  # type: ignore[return-value]
    # Last resort
    last = resolve_available(LAST_RESORT_LOGICAL)
    if not _ok(last):
        raise RuntimeError(
            f"No available chat model deployment for task {task!r} "
            f"(chat_only={chat_only}) and last-resort "
            f"{LAST_RESORT_LOGICAL!r} is unavailable or non-chat. "
            f"Check LOGICAL_DEPLOYMENTS in model_routing.py."
        )
    return last  # type: ignore[return-value]
