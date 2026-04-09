import mimetypes
import subprocess
import shutil
from pathlib import Path
from email.utils import formatdate
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from api.directory import _safe_resolve

router = APIRouter()

# Ensure common types are registered
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("image/jpeg", ".jpeg")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/bmp", ".bmp")
mimetypes.add_type("image/gif", ".gif")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/plain", ".txt")
mimetypes.add_type("text/plain", ".log")
mimetypes.add_type("text/plain", ".csv")
mimetypes.add_type("text/yaml", ".yaml")
mimetypes.add_type("text/yaml", ".yml")
mimetypes.add_type("text/xml", ".xml")
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("video/x-msvideo", ".avi")
mimetypes.add_type("video/quicktime", ".mov")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/x-flv", ".flv")
mimetypes.add_type("video/x-ms-wmv", ".wmv")


@router.get("/api/file")
async def get_file(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    stat = resolved.stat()
    last_mod = formatdate(stat.st_mtime, usegmt=True)
    return FileResponse(str(resolved), media_type=mime_type, headers={"Last-Modified": last_mod, "Cache-Control": "public, max-age=300"})


@router.get("/api/download")
async def download_file(path: str = Query(..., description="Absolute file or directory path")):
    resolved = _safe_resolve(path)

    if resolved.is_file():
        mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        return FileResponse(str(resolved), media_type=mime_type, filename=resolved.name)

    if resolved.is_dir():
        import zipfile
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in sorted(resolved.rglob("*")):
                if file.is_file() and not any(p.startswith(".") for p in file.relative_to(resolved).parts):
                    arcname = str(file.relative_to(resolved))
                    zf.write(file, arcname)
        buf.seek(0)

        filename = resolved.name + ".zip"
        safe_name = filename.replace('"', '_')
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}"',
                "Content-Length": str(buf.getbuffer().nbytes),
            },
        )

    raise HTTPException(status_code=400, detail="Path is not a file or directory")


import hashlib
import asyncio

_THUMB_CACHE_DIR = Path("/vePFS/shock/.CACHE/tianyan_thumbs")
_THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Small images (< 200KB): serve original file instead of generating thumbnail
_SMALL_IMAGE_THRESHOLD = 200 * 1024


def _generate_thumbnail(resolved: Path, size: int, cache_path: Path) -> bytes:
    """Generate thumbnail (runs in thread pool to avoid blocking event loop)."""
    from PIL import Image
    import io
    img = Image.open(str(resolved))
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    thumb_bytes = buf.getvalue()
    # Write to cache (atomic via temp file)
    try:
        tmp = cache_path.with_suffix('.tmp')
        tmp.write_bytes(thumb_bytes)
        tmp.rename(cache_path)
    except OSError:
        pass
    return thumb_bytes


@router.get("/api/thumbnail")
async def get_thumbnail(path: str = Query(..., description="Absolute image file path"),
                        size: int = Query(48, ge=16, le=1024)):
    """Return a small thumbnail of an image file, with disk cache."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or ""
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Not an image file")

    stat = resolved.stat()
    if stat.st_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large for thumbnail generation")

    # Small images: serve the original directly (faster than re-encoding)
    if stat.st_size < _SMALL_IMAGE_THRESHOLD:
        return FileResponse(str(resolved), media_type=mime_type,
                            headers={"Cache-Control": "public, max-age=3600"})

    # Check disk cache (keyed by path + mtime + size)
    cache_key = hashlib.md5(f"{resolved}|{stat.st_mtime}|{size}".encode()).hexdigest()
    cache_path = _THUMB_CACHE_DIR / f"{cache_key}.png"
    if cache_path.exists():
        return FileResponse(str(cache_path), media_type="image/png",
                            headers={"Cache-Control": "public, max-age=3600"})

    try:
        # Run PIL in thread pool so it doesn't block the event loop
        thumb_bytes = await asyncio.to_thread(_generate_thumbnail, resolved, size, cache_path)
        return Response(content=thumb_bytes, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=3600"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail generation failed: {e}")


# Video formats natively supported by browsers — no transcode needed
_BROWSER_NATIVE_VIDEO = {".mp4", ".webm", ".ogg"}


@router.get("/api/video")
async def get_video(path: str = Query(..., description="Absolute video file path")):
    """Stream video, transcoding non-browser-native formats (mkv, avi, mov, etc.) to mp4 on the fly."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    ext = resolved.suffix.lower()

    # For browser-native formats, serve directly
    if ext in _BROWSER_NATIVE_VIDEO:
        mime_type = mimetypes.guess_type(str(resolved))[0] or "video/mp4"
        return FileResponse(str(resolved), media_type=mime_type)

    # Check ffmpeg is available
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="ffmpeg not found — cannot transcode video")

    def _stream():
        cmd = [
            "ffmpeg",
            "-i", str(resolved),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "23",
            "-c:a", "aac",
            "-movflags", "frag_keyframe+empty_moov+faststart",
            "-f", "mp4",
            "-loglevel", "error",
            "pipe:1",
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.stderr.close()
            proc.wait()

    return StreamingResponse(_stream(), media_type="video/mp4")
