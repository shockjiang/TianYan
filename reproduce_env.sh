#!/bin/bash
# reproduce_env.sh — Recreate the project's .venv from uv.lock
#
# Usage: ./reproduce_env.sh
# Requires: uv (https://github.com/astral-sh/uv) on PATH
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v uv >/dev/null 2>&1; then
    echo "error: 'uv' not found on PATH. Install: https://github.com/astral-sh/uv" >&2
    exit 1
fi

# Honor the user's shared cache locations if set; otherwise uv uses its defaults.
export UV_CACHE_DIR="${UV_CACHE_DIR:-$HOME/shock/.CACHE/uv_cache}"

PYTHON_VERSION=3.11

echo "[1/2] Creating .venv with Python ${PYTHON_VERSION}..."
uv venv .venv --python "${PYTHON_VERSION}"

echo "[2/2] Installing pinned dependencies from uv.lock..."
uv pip sync --python .venv/bin/python uv.lock

echo
echo "Done. Activate with: source .venv/bin/activate"
echo "Or launch the app:   ./start.sh"
