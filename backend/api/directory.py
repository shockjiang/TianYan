import os
import json
import asyncio
import time
from collections import deque
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter()

# Tracks root directories that have been loaded via the directory API.
# Only files under these roots are accessible through the file APIs.
_allowed_roots: set[str] = set()


def _is_utf8_safe(name: str) -> bool:
    """True if *name* can be encoded as UTF-8.

    Filesystems can hold names that aren't valid UTF-8 (Python represents
    those bytes via surrogateescape, e.g. b'\\xef' becomes '\\udcef').
    Such names break JSON responses, and the browser can't usefully select
    them anyway, so the scanners just skip them.
    """
    try:
        name.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def _safe_resolve(path: str, allowed_root: str | None = None) -> Path:
    """Resolve path and validate it is under an allowed root."""
    resolved = Path(path).resolve()
    if allowed_root:
        root = Path(allowed_root).resolve()
        if not str(resolved).startswith(str(root) + "/") and resolved != root:
            raise HTTPException(status_code=403, detail="Path traversal denied")
    elif _allowed_roots:
        if not any(
            str(resolved).startswith(r + "/") or str(resolved) == r
            for r in _allowed_roots
        ):
            raise HTTPException(status_code=403, detail="Path is not under any loaded root directory")
    else:
        raise HTTPException(status_code=403, detail="No root directories have been loaded yet")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {resolved}")
    return resolved


def _scan_directory(
    dir_path: Path,
    depth: int = 1,
    current_depth: int = 0,
    max_entries: int = 10000,
    _counter: list[int] | None = None,
) -> dict:
    """Recursively scan directory up to given depth.

    Stops scanning after *max_entries* total entries have been collected
    to protect against extremely large directory trees.
    """
    if _counter is None:
        _counter = [0]

    result = {
        "name": dir_path.name or str(dir_path),
        "path": str(dir_path),
        "type": "directory",
    }
    if current_depth >= depth:
        result["children"] = []
        try:
            with os.scandir(dir_path) as it:
                result["hasChildren"] = any(
                    not e.name.startswith('.') and _is_utf8_safe(e.name) for e in it
                )
        except PermissionError:
            result["hasChildren"] = False
        return result

    children = []
    try:
        # os.scandir is much faster than Path.iterdir — it uses the
        # dirent info from readdir() so is_dir/is_file rarely need an
        # extra stat() call.
        with os.scandir(dir_path) as it:
            raw = sorted(it, key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
        for entry in raw:
            if _counter[0] >= max_entries:
                break
            if entry.name.startswith("."):
                continue
            if not _is_utf8_safe(entry.name):
                continue
            if entry.is_dir(follow_symlinks=False):
                _counter[0] += 1
                children.append(_scan_directory(Path(entry.path), depth, current_depth + 1, max_entries, _counter))
            elif entry.is_file(follow_symlinks=False):
                _counter[0] += 1
                ext = os.path.splitext(entry.name)[1].lower()
                children.append({
                    "name": entry.name,
                    "path": entry.path,
                    "type": "file",
                    "extension": ext,
                })
    except PermissionError:
        pass
    result["children"] = children
    return result


@router.get("/api/directory")
async def get_directory(path: str = Query(..., description="Root directory path"),
                        depth: int = Query(1, ge=1, le=10)):
    # The directory endpoint is how users load a root; resolve without
    # restriction first, then register the root so subsequent file
    # requests are allowed.
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {resolved}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    _allowed_roots.add(str(resolved))
    return _scan_directory(resolved, depth=depth)


@router.get("/api/directory/stream")
async def stream_directory(path: str = Query(..., description="Root directory path"),
                           max_entries: int = Query(50000, ge=1000, le=200000)):
    """SSE endpoint that streams the full directory tree via BFS."""
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {resolved}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    _allowed_roots.add(str(resolved))

    # Directories to skip during background scan (waste budget, rarely useful)
    _skip_dirs = {
        "node_modules", "__pycache__", ".git", ".hg", ".svn",
        "venv", ".venv", "env", ".env", ".tox",
        ".next", ".nuxt", "dist", "build", ".cache",
        ".eggs", "*.egg-info",
    }

    async def generate():
        queue = deque([resolved])
        total = 0
        t0 = time.time()

        while queue and total < max_entries:
            dir_path = queue.popleft()
            children = []
            try:
                with os.scandir(dir_path) as it:
                    raw = sorted(it, key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
                for entry in raw:
                    if total >= max_entries:
                        break
                    if entry.name.startswith('.'):
                        continue
                    if not _is_utf8_safe(entry.name):
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        total += 1
                        skip = entry.name in _skip_dirs or entry.name.endswith('.egg-info')
                        child_path = Path(entry.path)
                        has_children = False
                        if not skip:
                            try:
                                with os.scandir(child_path) as sub:
                                    has_children = any(
                                        not e.name.startswith('.') and _is_utf8_safe(e.name) for e in sub
                                    )
                            except OSError:
                                pass
                        children.append({
                            "name": entry.name, "path": entry.path,
                            "type": "directory", "hasChildren": has_children or skip, "children": [],
                        })
                        # Only recurse into non-skipped dirs
                        if has_children and not skip:
                            queue.append(child_path)
                    elif entry.is_file(follow_symlinks=False):
                        total += 1
                        ext = os.path.splitext(entry.name)[1].lower()
                        children.append({
                            "name": entry.name, "path": entry.path,
                            "type": "file", "extension": ext,
                        })
            except OSError:
                continue

            payload = json.dumps({"path": str(dir_path), "children": children})
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0)

        stats = json.dumps({"total": total, "elapsed": round(time.time() - t0, 2)})
        yield f"event: done\ndata: {stats}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
