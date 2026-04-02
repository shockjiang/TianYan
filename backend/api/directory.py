import os
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()


def _safe_resolve(path: str, allowed_root: str | None = None) -> Path:
    """Resolve path and validate it doesn't escape allowed_root."""
    resolved = Path(path).resolve()
    if allowed_root:
        root = Path(allowed_root).resolve()
        if not str(resolved).startswith(str(root)):
            raise HTTPException(status_code=403, detail="Path traversal denied")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {resolved}")
    return resolved


def _scan_directory(dir_path: Path, depth: int = 1, current_depth: int = 0) -> dict:
    """Recursively scan directory up to given depth."""
    result = {
        "name": dir_path.name or str(dir_path),
        "path": str(dir_path),
        "type": "directory",
    }
    if current_depth >= depth:
        result["children"] = []
        result["hasChildren"] = any(dir_path.iterdir())
        return result

    children = []
    try:
        entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                children.append(_scan_directory(entry, depth, current_depth + 1))
            elif entry.is_file():
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
    resolved = _safe_resolve(path)
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return _scan_directory(resolved, depth=depth)
