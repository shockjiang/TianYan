#!/bin/bash
# reproduce_env.sh — Recreate backend .venv (uv.lock) and frontend node_modules (package-lock.json)
#
# Usage: ./reproduce_env.sh
# Requires: uv (https://github.com/astral-sh/uv) and npm on PATH
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v uv >/dev/null 2>&1; then
    echo "error: 'uv' not found on PATH. Install: https://github.com/astral-sh/uv" >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "error: 'npm' not found on PATH. Install Node.js (>=18)." >&2
    exit 1
fi

# Honor the user's shared cache locations if set; otherwise uv uses its defaults.
export UV_CACHE_DIR="${UV_CACHE_DIR:-$HOME/shock/.CACHE/uv_cache}"

# Pull packages from Tsinghua's PyPI mirror (override by exporting UV_DEFAULT_INDEX).
export UV_DEFAULT_INDEX="${UV_DEFAULT_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"

PYTHON_VERSION=3.11

echo "[1/3] Creating .venv with Python ${PYTHON_VERSION}..."
uv venv .venv --python "${PYTHON_VERSION}"

echo "[2/3] Installing pinned backend dependencies from uv.lock (index: ${UV_DEFAULT_INDEX})..."
uv pip sync --python .venv/bin/python --default-index "${UV_DEFAULT_INDEX}" uv.lock

echo "[3/3] Installing frontend dependencies from frontend/package-lock.json..."
(cd "$SCRIPT_DIR/frontend" && npm ci)

echo
echo "Done. Activate backend with: source .venv/bin/activate"
echo "Or launch the app:           ./start.sh"
