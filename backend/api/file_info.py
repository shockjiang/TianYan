import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from api.directory import _safe_resolve

router = APIRouter()


@router.get("/api/file-info")
async def get_file_info(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    stat = resolved.stat()
    info = {
        "path": str(resolved),
        "name": resolved.name,
        "extension": resolved.suffix.lower(),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "dimensions": None,
    }

    # Try to get image dimensions
    mime_ext = resolved.suffix.lower()
    if mime_ext in (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"):
        try:
            from PIL import Image
            with Image.open(str(resolved)) as img:
                info["dimensions"] = list(img.size)
        except Exception:
            pass

    return info
