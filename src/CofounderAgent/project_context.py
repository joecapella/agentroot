"""Auto-load project context files into the system prompt.

When the agent starts (or when a project tag is detected), read key
configuration files and summarise them so the LLM knows the codebase
shape without Joseph having to paste it every time.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Files we automatically slurp when present.
CONTEXT_FILES: List[str] = [
    "package.json",
    "README.md",
    "README",
    "pyproject.toml",
    "setup.py",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
    "Dockerfile",
    "docker-compose.yml",
    "azure.yaml",
    "tsconfig.json",
    "next.config.mjs",
    "prisma/schema.prisma",
    ".agents/SKILL.md",
    "AGENTS.md",
    ".bob/ARCHITECTURE.md",
    ".bob/CONVENTIONS.md",
]

MAX_CHARS_PER_FILE = 4_000
MAX_TOTAL_CONTEXT_CHARS = 12_000


def _safe_read(path: Path) -> Optional[str]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        return text[:MAX_CHARS_PER_FILE]
    except Exception as exc:
        logger.debug("project_context: skipped %s (%s)", path, exc)
        return None


def gather_project_context(repo_root: Optional[str] = None) -> str:
    """Return a markdown block summarising the project."""
    root = Path(repo_root) if repo_root else Path.cwd()
    pieces: List[str] = []
    total = 0

    for rel in CONTEXT_FILES:
        path = root / rel
        if not path.is_file():
            continue
        text = _safe_read(path)
        if text is None:
            continue
        header = f"\n--- {rel} ---\n"
        block = header + text + "\n"
        if total + len(block) > MAX_TOTAL_CONTEXT_CHARS:
            pieces.append(f"\n--- {rel} ---\n[truncated: context budget exceeded]\n")
            break
        pieces.append(block)
        total += len(block)

    if not pieces:
        return ""

    return (
        "\n=== PROJECT CONTEXT ===\n"
        + "".join(pieces)
        + "\n=== END PROJECT CONTEXT ===\n"
    )


def gather_git_summary(repo_root: Optional[str] = None) -> str:
    """Return a one-line git summary if inside a repo."""
    root = Path(repo_root) if repo_root else Path.cwd()
    import subprocess

    try:
        branch = subprocess.check_output(
            ["git", "-C", str(root), "branch", "--show-current"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).strip()
    except Exception:
        branch = None

    try:
        sha = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).strip()
    except Exception:
        sha = None

    if branch and sha:
        return f"\n[git: {branch} @ {sha}]\n"
    return ""
