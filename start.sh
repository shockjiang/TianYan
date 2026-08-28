#!/bin/bash
# start.sh — Run both backend and frontend dev servers
set -e

echo "Starting TianYan..."

# Resolve script directory so paths work regardless of where this lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure tools installed by reproduce_env.sh (ffmpeg/ffprobe, uv) are on
# PATH for the child uvicorn/vite processes regardless of shell config.
export PATH="$HOME/.local/bin:$PATH"

# vite v8 needs Node ^20.19 || >=22.12 (same floor as REQUIRED_NODE_MAJOR in
# reproduce_env.sh). The system /usr/bin/node here is v12 and crashes vite with
# "SyntaxError: Unexpected token '.'". Prefer the newest nvm-managed node that
# clears that floor, so `npx vite` works even from a shell that never sourced
# nvm. (reproduce_env.sh is what actually installs such a node.)
REQUIRED_NODE_MAJOR=20
for node_bin in $(ls -d "$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -Vr); do
    node_major="${node_bin#*/node/v}"; node_major="${node_major%%.*}"
    if [ "${node_major:-0}" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
        export PATH="$node_bin:$PATH"
        break
    fi
done

# Start backend (uses project-local .venv)
cd "$SCRIPT_DIR/backend"
"$SCRIPT_DIR/.venv/bin/uvicorn" main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID) on http://0.0.0.0:8000"

# Start frontend
cd "$SCRIPT_DIR/frontend"
npx vite --host 0.0.0.0 --port 10086 &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID) on http://0.0.0.0:10086"

echo ""
echo "TianYan is running!"
echo "  Frontend: http://localhost:10086"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
