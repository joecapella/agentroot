"""Pydantic-settings based configuration for CofounderAgent.

All env vars are validated at startup so the container fails fast on
misconfiguration rather than 500'ing at runtime.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Azure AI
    azure_openai_endpoint: Optional[str] = Field(default=None)
    openai_api_version: str = Field(default="2025-03-01-preview")
    azure_ai_model_deployment_name: str = Field(default="gpt-5.5")

    # Foundry project endpoint (used by the Node backend; agent container
    # only needs the OpenAI endpoint for chat model construction).
    azure_ai_project_endpoint: Optional[str] = Field(default=None)

    # Observability
    applicationinsights_connection_string: Optional[str] = Field(default=None)

    # Runtime
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    json_logs: bool = Field(default=False)
    port: int = Field(default=8088)
    host: str = Field(default="0.0.0.0")

    # Health / probes
    health_port: int = Field(default=8080)
    enable_health_server: bool = Field(default=True)

    # Safety
    max_message_chars: int = Field(default=20_000)
    persona_allowlist: str = Field(default="orchestrator,code_assistant,brand_designer,ops,vision")

    # Dev / local mode
    local_dev_mode: bool = Field(default=False)
    mock_azure_credentials: bool = Field(default=False)

    @property
    def effective_endpoint(self) -> str:
        return self.azure_openai_endpoint or os.getenv("AZURE_OPENAI_ENDPOINT", "")

    def parsed_persona_allowlist(self) -> set[str]:
        return {p.strip() for p in self.persona_allowlist.split(",") if p.strip()}


def configure_logging(*, level: str, json_logs: bool) -> None:
    """Configure root logger. JSON format when ``json_logs=True``."""
    if json_logs:
        import json

        class JsonFormatter(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                payload = {
                    "timestamp": self.formatTime(record),
                    "level": record.levelname,
                    "logger": record.name,
                    "message": record.getMessage(),
                }
                if record.exc_info:
                    payload["exception"] = self.formatException(record.exc_info)
                return json.dumps(payload, default=str)

        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root = logging.getLogger()
        root.handlers.clear()
        root.addHandler(handler)
        root.setLevel(level)
    else:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
