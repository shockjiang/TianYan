"""POST /api/rename — rename a file or directory under a loaded root."""

from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from api.directory import _safe_resolve

router = APIRouter()


@router.post("/api/rename")
async def rename(payload: dict = Body(...)):
    """Rename *path* to its sibling *new_name*.

    Refuses if *new_name* contains path separators or traversal segments,
    or if the destination already exists.
    """
    path = payload.get("path")
    new_name = payload.get("new_name")
    if not isinstance(path, str) or not path:
        raise HTTPException(400, "Missing or invalid 'path'")
    if not isinstance(new_name, str) or not new_name.strip():
        raise HTTPException(400, "Missing or invalid 'new_name'")

    new_name = new_name.strip()
    if "/" in new_name or "\\" in new_name or new_name in (".", ".."):
        raise HTTPException(400, "new_name must be a plain basename")

    resolved = _safe_resolve(path)
    if not resolved.exists():
        raise HTTPException(404, f"Path not found: {resolved}")

    new_path = resolved.parent / new_name
    if new_path == resolved:
        return {"old_path": str(resolved), "new_path": str(resolved), "name": new_name}
    if new_path.exists():
        raise HTTPException(409, f"Already exists: {new_path}")

    try:
        resolved.rename(new_path)
    except OSError as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")

    return {
        "old_path": str(resolved),
        "new_path": str(new_path),
        "name": new_name,
        "parent": str(resolved.parent),
        "type": "directory" if new_path.is_dir() else "file",
    }
