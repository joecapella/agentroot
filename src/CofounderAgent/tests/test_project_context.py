"""Tests for project context auto-loader."""

import json
import tempfile
from pathlib import Path

from project_context import gather_project_context


class TestGatherProjectContext:
    def test_reads_package_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = Path(tmp) / "package.json"
            pkg.write_text(json.dumps({"name": "test-project", "version": "1.0.0"}))
            ctx = gather_project_context(tmp)
            assert "test-project" in ctx
            assert "package.json" in ctx

    def test_empty_when_no_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = gather_project_context(tmp)
            assert ctx == ""

    def test_respects_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = Path(tmp) / "package.json"
            pkg.write_text("x" * 20_000)
            ctx = gather_project_context(tmp)
            # Should still include header but content is capped per file
            assert "package.json" in ctx
