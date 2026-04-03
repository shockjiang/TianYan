import mimetypes
import subprocess
import shutil
from pathlib import Path
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
    return FileResponse(str(resolved), media_type=mime_type)


@router.get("/api/download")
async def download_file(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    return FileResponse(str(resolved), media_type=mime_type, filename=resolved.name)


@router.get("/api/thumbnail")
async def get_thumbnail(path: str = Query(..., description="Absolute image file path"),
                        size: int = Query(48, ge=16, le=256)):
    """Return a small thumbnail of an image file."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or ""
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Not an image file")

    if resolved.stat().st_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large for thumbnail generation")

    try:
        from PIL import Image
        import io
        img = Image.open(str(resolved))
        img.thumbnail((size, size))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return Response(content=buf.read(), media_type="image/png")
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
