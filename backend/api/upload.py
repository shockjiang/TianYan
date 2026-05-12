"""API for uploading files into directories that have already been loaded as roots."""

from pathlib import Path
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from api.directory import _safe_resolve

router = APIRouter()

MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024  # 10 GB per file
CHUNK = 1024 * 1024  # 1 MiB


def _safe_relpath(rel: str, root: Path) -> Path | None:
    """Resolve *rel* under *root* and return the destination Path, or None
    if *rel* would escape *root* or is otherwise invalid."""
    rel = (rel or "").replace("\\", "/").strip()
    if not rel or rel.startswith("/"):
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    dest = root.joinpath(*parts)
    try:
        dest.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    return dest


@router.post("/api/upload")
async def upload(
    dir: str = Form(..., description="Absolute destination directory"),
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(default=[], description="Optional relative paths for each file (parallel to files); enables directory uploads"),
    overwrite: bool = Form(False),
):
    """Write *files* into *dir*. The destination must be under a loaded root.

    When *paths* is supplied (parallel to *files*), each file is placed at
    ``dir/<paths[i]>`` and intermediate directories are created. Otherwise
    files land directly under *dir* using their basenames.
    """
    resolved = _safe_resolve(dir)
    if not resolved.is_dir():
        raise HTTPException(400, "Destination is not a directory")

    uploaded = []
    skipped = []

    for i, f in enumerate(files):
        original = f.filename or ""
        rel = paths[i] if i < len(paths) and paths[i] else Path(original).name
        dest = _safe_relpath(rel, resolved)
        if dest is None:
            skipped.append({"name": original or rel, "reason": "invalid path"})
            continue

        if dest.exists() and not overwrite:
            skipped.append({"name": str(dest.relative_to(resolved)), "reason": "already exists"})
            continue

        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            skipped.append({"name": str(dest.relative_to(resolved)), "reason": f"mkdir failed: {e}"})
            continue

        size = 0
        try:
            with open(dest, "wb") as out:
                while True:
                    chunk = await f.read(CHUNK)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_UPLOAD_SIZE:
                        out.close()
                        dest.unlink(missing_ok=True)
                        raise HTTPException(413, f"File too large: {dest.name}")
                    out.write(chunk)
        except HTTPException:
            raise
        except Exception as e:
            try:
                dest.unlink(missing_ok=True)
            except Exception:
                pass
            skipped.append({"name": str(dest.relative_to(resolved)), "reason": f"{type(e).__name__}: {e}"})
            continue

        uploaded.append({
            "name": str(dest.relative_to(resolved)),
            "size": size,
            "path": str(dest),
        })

    return {"uploaded": uploaded, "skipped": skipped, "dir": str(resolved)}
