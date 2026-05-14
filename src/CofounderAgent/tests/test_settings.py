"""Tests for settings validation."""

import os
from unittest.mock import patch

from settings import Settings, configure_logging


class TestSettings:
    def test_defaults(self):
        s = Settings()
        assert s.log_level == "INFO"
        assert s.port == 8088
        assert "orchestrator" in s.persona_allowlist

    def test_persona_allowlist_from_string(self):
        with patch.dict(os.environ, {"PERSONA_ALLOWLIST": "ops,vision"}):
            s = Settings()
            assert s.parsed_persona_allowlist() == {"ops", "vision"}

    def test_local_dev_mode_flag(self):
        with patch.dict(os.environ, {"LOCAL_DEV_MODE": "true"}):
            s = Settings()
            assert s.local_dev_mode is True


class TestLogging:
    def test_json_logs_does_not_crash(self):
        configure_logging(level="DEBUG", json_logs=True)
        import logging

        logging.getLogger("test").info("hello")
