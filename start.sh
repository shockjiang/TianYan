#!/bin/bash
# start.sh — Run both backend and frontend dev servers
set -e

echo "Starting TianYan..."

# Resolve script directory so paths work regardless of where this lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start backend (uses project-local .venv)
cd "$SCRIPT_DIR/backend"
"$SCRIPT_DIR/.venv/bin/uvicorn" main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID) on http://0.0.0.0:8000"

# Start frontend
cd "$SCRIPT_DIR/frontend"
npx vite --host 0.0.0.0 --port 15090 &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID) on http://0.0.0.0:15090"

echo ""
echo "TianYan is running!"
echo "  Frontend: http://localhost:15090"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
