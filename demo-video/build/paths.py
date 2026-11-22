"""Where the build finds its inputs.

These scripts used to carry the absolute path of the machine that rendered the video in
2026-11-22. The path is derived here instead, so a clone can re-render without editing anything,
and each one can be overridden for a different layout:

    EDI820_ROOT      the repository this build belongs to
    EDI820_NODE_BIN  the directory holding node/npm/npx
    EDI820_SYSROOT   the local shared-library sysroot used by headless Chromium
"""
import os
from pathlib import Path

BUILD = Path(__file__).resolve().parent
REPO = Path(os.environ.get("EDI820_ROOT", str(BUILD.parent.parent)))
WORKSPACE = REPO.parent.parent
ROOT = str(REPO)
WORKSPACE_ROOT = str(WORKSPACE)
NODE_BIN = os.environ.get("EDI820_NODE_BIN", str(WORKSPACE / ".toolchain" / "node-v22.23.5-linux-x64" / "bin"))
SYSROOT = os.environ.get("EDI820_SYSROOT", str(WORKSPACE / ".sysroot"))
