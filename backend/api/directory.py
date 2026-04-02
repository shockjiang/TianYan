from pathlib import Path
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()

# Tracks root directories that have been loaded via the directory API.
# Only files under these roots are accessible through the file APIs.
_allowed_roots: set[str] = set()


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
        result["hasChildren"] = any(not e.name.startswith('.') for e in dir_path.iterdir())
        return result

    children = []
    try:
        entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            if _counter[0] >= max_entries:
                break
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                _counter[0] += 1
                children.append(_scan_directory(entry, depth, current_depth + 1, max_entries, _counter))
            elif entry.is_file():
                _counter[0] += 1
                children.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "file",
                    "extension": entry.suffix.lower(),
                    "size": entry.stat().st_size,
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
