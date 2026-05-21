import mimetypes
import subprocess
import shutil
import os
import tempfile
from pathlib import Path
from email.utils import formatdate
from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from api.directory import _safe_resolve

router = APIRouter()


def _pick_cache_base() -> Path:
    """Pick a writable directory for transient caches (thumbnails, video
    transcodes). Order: $TIANYAN_CACHE_DIR, $XDG_CACHE_HOME/tianyan,
    $HOME/.cache/tianyan, $TMPDIR/tianyan. The first one we can create
    wins, so the server always starts even on read-only homes."""
    candidates = []
    if os.environ.get("TIANYAN_CACHE_DIR"):
        candidates.append(Path(os.environ["TIANYAN_CACHE_DIR"]))
    if os.environ.get("XDG_CACHE_HOME"):
        candidates.append(Path(os.environ["XDG_CACHE_HOME"]) / "tianyan")
    if os.environ.get("HOME"):
        candidates.append(Path(os.environ["HOME"]) / ".cache" / "tianyan")
    candidates.append(Path(tempfile.gettempdir()) / "tianyan")
    for base in candidates:
        try:
            base.mkdir(parents=True, exist_ok=True)
            # Quick writability probe
            probe = base / ".write_test"
            probe.write_bytes(b"")
            probe.unlink(missing_ok=True)
            return base
        except OSError:
            continue
    raise RuntimeError("No writable cache directory found")


_CACHE_BASE = _pick_cache_base()

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
mimetypes.add_type("application/octet-stream", ".ply")
mimetypes.add_type("model/vnd.usd", ".usd")
mimetypes.add_type("model/vnd.usd", ".usda")
mimetypes.add_type("model/vnd.usd", ".usdc")
mimetypes.add_type("model/vnd.usdz+zip", ".usdz")


@router.get("/api/file")
async def get_file(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    stat = resolved.stat()
    last_mod = formatdate(stat.st_mtime, usegmt=True)
    return FileResponse(str(resolved), media_type=mime_type, headers={"Last-Modified": last_mod, "Cache-Control": "public, max-age=300"})


@router.get("/api/raw/{full_path:path}")
async def get_raw_file(full_path: str):
    """Serve a file by absolute path embedded in the URL.

    Used by viewers that need relative-URL resolution inside the served
    document — chiefly the HTML iframe viewer, where ./styles.css must
    resolve to a sibling file. The URL shape is /api/raw/<absolute path>,
    e.g. /api/raw//root/shock/share/blog/index.html (note the double slash
    after /raw — the absolute path keeps its leading /). Sandboxed by
    _safe_resolve so only files under loaded roots are accessible.
    """
    abs_path = full_path if full_path.startswith("/") else "/" + full_path
    resolved = _safe_resolve(abs_path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    stat = resolved.stat()
    last_mod = formatdate(stat.st_mtime, usegmt=True)
    return FileResponse(
        str(resolved),
        media_type=mime_type,
        headers={"Last-Modified": last_mod, "Cache-Control": "public, max-age=300"},
    )


@router.get("/api/download")
async def download_file(
    path: str = Query(..., description="Absolute file or directory path"),
    raw: int = Query(0, description="If 1, force raw bytes even for non-native-codec videos"),
):
    resolved = _safe_resolve(path)

    if resolved.is_file():
        # For video files whose codec the browser can't play, the raw
        # bytes also won't play in most desktop video players. Default to
        # serving the transcoded H.264 cache (same one /api/video uses)
        # and append .h264.mp4 to the filename so it's obvious the file
        # has been re-encoded. Callers can pass ?raw=1 to opt out.
        if not raw and resolved.suffix.lower() in _PROBE_VIDEO_EXTS and not _is_browser_native_video(resolved):
            cache_path = await _ensure_h264_cache(resolved)
            new_name = resolved.stem + ".h264.mp4"
            return FileResponse(str(cache_path), media_type="video/mp4", filename=new_name)

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
import functools

_THUMB_CACHE_DIR = _CACHE_BASE / "thumbs"
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


# Video container extensions whose codec is worth probing before deciding
# whether transcoding is needed. Other extensions always transcode.
_PROBE_VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mkv", ".mov"}

# Codec names (per ffprobe stream=codec_name) that modern browsers can
# render in <video>. Everything else (mpeg4 a.k.a. mp4v, hevc, prores …)
# must be transcoded to H.264.
_NATIVE_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}


@functools.lru_cache(maxsize=4096)
def _video_codec_cached(path: str, mtime: float) -> str:
    """ffprobe the first video stream's codec_name. Cached per (path, mtime).

    Returns an empty string if ffprobe is unavailable or fails — callers
    treat that as "unknown" and fall back to extension-based heuristics.
    """
    if not shutil.which("ffprobe"):
        return ""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error",
             "-select_streams", "v:0",
             "-show_entries", "stream=codec_name",
             "-of", "csv=p=0",
             path],
            capture_output=True, text=True, timeout=8,
        )
        return (out.stdout.strip().splitlines() or [""])[0].strip().lower()
    except Exception:
        return ""


def _is_browser_native_video(resolved: Path) -> bool:
    """True if the browser can play this file directly (no transcode)."""
    ext = resolved.suffix.lower()
    if ext not in _PROBE_VIDEO_EXTS:
        return False
    codec = _video_codec_cached(str(resolved), resolved.stat().st_mtime)
    if not codec:
        # ffprobe unavailable: keep old behavior — trust the extension for
        # the small set of containers that *usually* hold a native codec.
        return ext in {".mp4", ".webm", ".ogg"}
    return codec in _NATIVE_VIDEO_CODECS

# Cache dir for transcoded videos
_VIDEO_CACHE_DIR = _CACHE_BASE / "videos"
_VIDEO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _serve_file_with_range(file_path: Path, request: Request, media_type: str) -> Response:
    """Serve a file with HTTP Range request support for seeking."""
    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        # Parse "bytes=START-END"
        range_spec = range_header.strip().replace("bytes=", "")
        parts = range_spec.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1

        def _range_stream():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk_size = min(65536, remaining)
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            _range_stream(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(length),
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=300",
            },
        )

    # No Range header — serve full file with Accept-Ranges hint
    def _full_stream():
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _full_stream(),
        media_type=media_type,
        headers={
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=300",
        },
    )


async def _ensure_h264_cache(resolved: Path) -> Path:
    """Return a cached H.264/AAC .mp4 transcode of *resolved*, creating it
    on demand. Same cache that /api/video has always used (keyed on
    path + mtime), so preview and download share work."""
    if not shutil.which("ffmpeg"):
        raise HTTPException(
            status_code=500,
            detail="Video needs transcoding but ffmpeg is not installed. "
                   "Run reproduce_env.sh to install a static build.",
        )

    stat = resolved.stat()
    cache_key = hashlib.md5(f"{resolved}|{stat.st_mtime}".encode()).hexdigest()
    cache_path = _VIDEO_CACHE_DIR / f"{cache_key}.mp4"
    if cache_path.exists():
        return cache_path

    tmp = cache_path.with_suffix(".tmp.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(resolved),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-loglevel", "error",
        str(tmp),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail=f"Transcode failed: {stderr.decode(errors='replace')[:500]}",
        )
    tmp.rename(cache_path)
    return cache_path


@router.get("/api/video")
async def get_video(request: Request, path: str = Query(..., description="Absolute video file path")):
    """Serve video with Range request support. Transcodes non-native formats to cached mp4."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Decide native-vs-transcode by inspecting the codec, not just the
    # extension — many .mp4 files carry codecs (mpeg4/hevc/prores/…) that
    # the browser <video> element can't decode even though the container
    # looks fine.
    if _is_browser_native_video(resolved):
        mime_type = mimetypes.guess_type(str(resolved))[0] or "video/mp4"
        return _serve_file_with_range(resolved, request, mime_type)

    cache_path = await _ensure_h264_cache(resolved)
    return _serve_file_with_range(cache_path, request, "video/mp4")
