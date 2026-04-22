"""API for previewing text files with head/tail lines."""

from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from api.directory import _safe_resolve

router = APIRouter()

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


@router.get("/api/text-preview")
async def text_preview(
    path: str = Query(...),
    head_n: int = Query(10, ge=1, le=5000),
    tail_n: int = Query(10, ge=0, le=5000),
):
    """Return head and tail lines of a text file."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    stat = resolved.stat()
    file_size = stat.st_size

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large")

    # For small files (< 100KB), just return all lines
    SMALL_THRESHOLD = 100 * 1024
    if file_size <= SMALL_THRESHOLD:
        try:
            text = resolved.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        lines = text.split("\n")
        return {
            "total_lines": len(lines),
            "head": lines,
            "tail": [],
            "head_n": len(lines),
            "tail_n": 0,
            "gap": 0,
            "full": True,
            "file_size": file_size,
        }

    # Large file: read head from start, tail by seeking from end
    head_lines = []
    try:
        with open(resolved, "r", encoding="utf-8", errors="replace") as f:
            for _ in range(head_n):
                line = f.readline()
                if not line:
                    break
                head_lines.append(line.rstrip("\n"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Count total lines (fast: just count newlines in binary mode)
    try:
        with open(resolved, "rb") as f:
            # Read in chunks to count newlines
            total_lines = 0
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                total_lines += chunk.count(b"\n")
            total_lines += 1  # Last line may not end with \n
    except Exception:
        total_lines = -1  # Unknown

    # Read tail by seeking backwards
    tail_lines = []
    if tail_n > 0:
        try:
            chunk_size = max(4096, tail_n * 256)
            with open(resolved, "rb") as f:
                f.seek(0, 2)
                fsize = f.tell()
                seek_pos = max(0, fsize - chunk_size)
                while True:
                    f.seek(seek_pos)
                    chunk = f.read(fsize - seek_pos)
                    lines = chunk.decode("utf-8", errors="replace").split("\n")
                    if len(lines) > tail_n or seek_pos == 0:
                        # Take last tail_n lines (skip the first partial line unless at file start)
                        if seek_pos > 0:
                            lines = lines[1:]  # First line is likely partial
                        tail_lines = lines[-tail_n:] if len(lines) > tail_n else lines
                        break
                    chunk_size *= 2
                    seek_pos = max(0, fsize - chunk_size)
        except Exception:
            pass

    gap = max(0, total_lines - len(head_lines) - len(tail_lines))

    return {
        "total_lines": total_lines,
        "head": head_lines,
        "tail": tail_lines,
        "head_n": len(head_lines),
        "tail_n": len(tail_lines),
        "gap": gap,
        "full": False,
        "file_size": file_size,
    }
