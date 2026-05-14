"""Tests for model_routing fallback logic and persona mapping."""

import os
from unittest.mock import patch

import pytest

from model_routing import (
    LOGICAL_DEPLOYMENTS,
    DeploymentSpec,
    PERSONA_TO_TASK,
    ROUTES,
    resolve_available,
    resolve_route_for_task,
)


class TestResolveAvailable:
    def test_returns_spec_when_available(self):
        spec = resolve_available("gpt-5.5")
        assert spec is not None
        assert spec.deployment == "gpt-5.5"
        assert spec.family == "azure_openai"

    def test_returns_none_for_unknown(self):
        assert resolve_available("nonexistent-model") is None

    def test_returns_none_for_unavailable(self):
        assert resolve_available("claude-opus-4-7") is None


class TestResolveRouteForTask:
    def test_deep_planning_defaults_to_gpt55_when_claude_unavailable(self):
        spec = resolve_route_for_task("deep_planning")
        assert spec.deployment == "gpt-5.5"

    def test_vision_defaults_to_kimi(self):
        spec = resolve_route_for_task("vision")
        assert spec.deployment == "Kimi-K2.6"

    def test_visual_skips_image_gen_for_chat(self):
        # visual route's default is gpt-image-2 which is family image_gen;
        # chat_only=True should skip it and fall back to gpt-5.5
        spec = resolve_route_for_task("visual")
        assert spec.family == "azure_openai"
        assert spec.deployment == "gpt-5.5"

    def test_raises_when_everything_broken(self):
        # Temporarily mark gpt-5.5 unavailable to force last-resort failure.
        orig = LOGICAL_DEPLOYMENTS["gpt-5.5"]
        LOGICAL_DEPLOYMENTS["gpt-5.5"] = DeploymentSpec(
            "gpt-5.5", "azure_openai", unavailable=True
        )
        try:
            with pytest.raises(RuntimeError) as exc_info:
                resolve_route_for_task("deep_planning")
            assert "No available chat model" in str(exc_info.value)
        finally:
            LOGICAL_DEPLOYMENTS["gpt-5.5"] = orig

    def test_env_override_wins(self):
        # gpt-5.5 → non-alnum chars (- and .) both become _, case preserved
        with patch.dict(os.environ, {"MODEL_DEPLOYMENT_gpt_5_5": "custom-gpt"}):
            from model_routing import deployment_for_model

            assert deployment_for_model("gpt-5.5") == "custom-gpt"


class TestPersonaToTask:
    def test_orchestrator_chat(self):
        assert PERSONA_TO_TASK["orchestrator"] == "general_chat"

    def test_code_assistant_file(self):
        assert PERSONA_TO_TASK["code_assistant"] == "code_file"


class TestRoutesShape:
    def test_every_task_has_route(self):
        for task in ROUTES:
            route = ROUTES[task]
            assert route.default_model
            assert route.default_model in LOGICAL_DEPLOYMENTS

    def test_fallbacks_differ_from_default(self):
        for task, route in ROUTES.items():
            if route.fallback:
                assert route.fallback != route.default_model
