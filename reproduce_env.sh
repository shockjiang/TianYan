#!/bin/bash
# reproduce_env.sh — Recreate backend .venv (uv.lock) and frontend node_modules (package-lock.json)
#
# Usage: ./reproduce_env.sh
# Designed for unprivileged users: installs uv and Node/npm into $HOME if they
# aren't already on PATH. No sudo, no apt.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Honor the user's shared cache locations if set; otherwise uv uses its defaults.
export UV_CACHE_DIR="${UV_CACHE_DIR:-$HOME/shock/.CACHE/uv_cache}"

# Pull packages from Tsinghua's PyPI mirror (override by exporting UV_DEFAULT_INDEX).
export UV_DEFAULT_INDEX="${UV_DEFAULT_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"

PYTHON_VERSION=3.11
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NVM_VERSION="${NVM_VERSION:-v0.40.1}"
NODE_VERSION="${NODE_VERSION:---lts}"

# --- helpers --------------------------------------------------------------

fetch() {
    # fetch <url> — print URL contents to stdout using curl or wget.
    local url="$1"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "$url"
    else
        echo "error: neither curl nor wget is available" >&2
        return 1
    fi
}

ensure_uv() {
    # uv installs to ~/.local/bin (or $XDG_BIN_HOME); make sure that's on PATH.
    export PATH="$HOME/.local/bin:$PATH"
    if command -v uv >/dev/null 2>&1; then
        echo "uv: $(command -v uv) ($(uv --version 2>&1 | head -1))"
        return
    fi
    echo "uv not found — installing into \$HOME (no sudo)..."
    fetch https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    if ! command -v uv >/dev/null 2>&1; then
        echo "error: uv installation finished but 'uv' still isn't on PATH." >&2
        echo "       expected at \$HOME/.local/bin/uv — add that directory to PATH." >&2
        exit 1
    fi
    echo "uv installed: $(uv --version)"
}

ensure_ffmpeg() {
    if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
        echo "ffmpeg: $(command -v ffmpeg) ($(ffmpeg -version 2>&1 | head -1))"
        return
    fi
    local bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"
    export PATH="$bin_dir:$PATH"

    local arch
    arch="$(uname -m)"
    local slug
    case "$arch" in
        x86_64|amd64)        slug="amd64" ;;
        aarch64|arm64)       slug="arm64" ;;
        *) echo "warning: no static ffmpeg build for arch '$arch'; skipping" >&2; return 0 ;;
    esac
    local url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${slug}-static.tar.xz"

    echo "ffmpeg not found — downloading static build (${slug}) into ${bin_dir} (no sudo)..."
    local tmp
    tmp="$(mktemp -d)"
    trap "rm -rf '$tmp'" RETURN
    if ! fetch "$url" > "$tmp/ffmpeg.tar.xz"; then
        echo "error: failed to download ${url}" >&2
        return 1
    fi
    (cd "$tmp" && tar -xJf ffmpeg.tar.xz)
    local extracted
    extracted="$(find "$tmp" -maxdepth 1 -type d -name "ffmpeg-*-${slug}-static" | head -1)"
    if [[ -z "$extracted" ]]; then
        echo "error: unexpected tarball layout in ${url}" >&2
        return 1
    fi
    install -m 0755 "$extracted/ffmpeg"  "$bin_dir/ffmpeg"
    install -m 0755 "$extracted/ffprobe" "$bin_dir/ffprobe"
    echo "ffmpeg installed: $(ffmpeg -version 2>&1 | head -1)"
}

ensure_npm() {
    if command -v npm >/dev/null 2>&1; then
        echo "npm: $(command -v npm) ($(npm --version))  node: $(node --version)"
        return
    fi

    # Source an existing nvm install if we have one.
    if [[ -s "$NVM_DIR/nvm.sh" ]]; then
        # shellcheck disable=SC1091
        \. "$NVM_DIR/nvm.sh"
    fi
    if ! command -v nvm >/dev/null 2>&1; then
        echo "nvm not found — installing into ${NVM_DIR}..."
        export NVM_DIR
        fetch "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
        # shellcheck disable=SC1091
        \. "$NVM_DIR/nvm.sh"
    fi
    if ! command -v nvm >/dev/null 2>&1; then
        echo "error: nvm install finished but 'nvm' still isn't loadable." >&2
        echo "       expected at ${NVM_DIR}/nvm.sh" >&2
        exit 1
    fi

    echo "Installing Node ${NODE_VERSION} via nvm..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    if ! command -v npm >/dev/null 2>&1; then
        echo "error: npm still missing after nvm install." >&2
        exit 1
    fi
    echo "node: $(node --version)  npm: $(npm --version)"
}

# --- run ------------------------------------------------------------------

ensure_uv
ensure_npm
ensure_ffmpeg

echo "[1/3] Creating .venv with Python ${PYTHON_VERSION}..."
uv venv .venv --python "${PYTHON_VERSION}"

echo "[2/3] Installing pinned backend dependencies from uv.lock (index: ${UV_DEFAULT_INDEX})..."
uv pip sync --python .venv/bin/python --default-index "${UV_DEFAULT_INDEX}" uv.lock

echo "[3/3] Installing frontend dependencies from frontend/package-lock.json..."
(cd "$SCRIPT_DIR/frontend" && npm ci)

echo
echo "Done. Activate backend with: source .venv/bin/activate"
echo "Or launch the app:           ./start.sh"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    echo
    echo "Note: Node was installed via nvm. To use 'node'/'npm' in new shells, add"
    echo "      this to your shell rc file:"
    echo "        export NVM_DIR=\"$NVM_DIR\""
    echo "        [ -s \"\$NVM_DIR/nvm.sh\" ] && \\. \"\$NVM_DIR/nvm.sh\""
fi
