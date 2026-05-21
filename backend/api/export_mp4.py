"""GET /api/export_mp4 — encode an image-sequence dataset to an H.264 mp4.

Supports .npy (single array), .npz (named arrays), and .h5/.hdf5 (datasets).
For multi-dataset containers, the caller may pass ``key=<name>``; otherwise
the first sequence-shaped dataset is picked. Output is cached on disk per
(path, key, mtime, fps), so subsequent exports are instant.
"""

import asyncio
import hashlib
import shutil
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from api.directory import _safe_resolve
from api.file import _VIDEO_CACHE_DIR

router = APIRouter()

_SUPPORTED_EXTS = {".npy", ".npz", ".h5", ".hdf5"}


def _to_rgb_uint8_stack(arr: np.ndarray) -> np.ndarray:
    """Coerce *arr* into shape (N, H, W, 3) dtype uint8 — what libx264 wants."""
    if arr.ndim == 3:
        n, h, w = arr.shape
        # Heuristic: (H, W, C) single image vs (N, H, W) grayscale stack.
        if w in (1, 3, 4) and h > 4 and n > 4:
            raise HTTPException(400, f"Shape {arr.shape} looks like a single image, not a sequence")
        arr = np.repeat(arr[..., None], 3, axis=-1)  # (N, H, W) → (N, H, W, 3)
    elif arr.ndim == 4:
        c = arr.shape[-1]
        if c == 1:
            arr = np.repeat(arr, 3, axis=-1)
        elif c == 4:
            arr = arr[..., :3]
        elif c != 3:
            raise HTTPException(400, f"Unsupported channel count: {c}")
    else:
        raise HTTPException(400, f"Cannot encode shape {arr.shape} as video")

    if arr.dtype == np.uint8:
        out = arr
    elif arr.dtype == bool:
        out = arr.astype(np.uint8) * 255
    elif np.issubdtype(arr.dtype, np.floating):
        mn = float(np.nanmin(arr))
        mx = float(np.nanmax(arr))
        if mx > mn:
            out = ((arr - mn) / (mx - mn) * 255).clip(0, 255).astype(np.uint8)
        else:
            out = np.zeros_like(arr, dtype=np.uint8)
    else:
        mn = float(arr.min())
        mx = float(arr.max())
        if mx > mn:
            out = ((arr.astype(np.float64) - mn) / (mx - mn) * 255).clip(0, 255).astype(np.uint8)
        else:
            out = np.zeros_like(arr, dtype=np.uint8)

    # yuv420p requires even H and W — pad if needed.
    n, h, w, c = out.shape
    pad_h = h % 2
    pad_w = w % 2
    if pad_h or pad_w:
        out = np.pad(out, ((0, 0), (0, pad_h), (0, pad_w), (0, 0)), mode="edge")
    return np.ascontiguousarray(out)


def _is_sequence_shape(shape) -> bool:
    if len(shape) == 3:
        n, h, w = shape
        return n > 1 and h > 4 and w > 4 and not (w in (1, 3, 4) and h > 4 and n > 4)
    if len(shape) == 4:
        c = shape[-1]
        return c in (1, 3, 4) and shape[1] > 4 and shape[2] > 4
    return False


def _load_array(resolved: Path, key: str | None) -> tuple[np.ndarray, str]:
    """Return (array, key-string-for-filename)."""
    ext = resolved.suffix.lower()
    if ext == ".npy":
        return np.asarray(np.load(str(resolved), mmap_mode="r")), resolved.stem
    if ext == ".npz":
        data = np.load(str(resolved), allow_pickle=False)
        if not key:
            for k in data.files:
                if _is_sequence_shape(data[k].shape):
                    return np.asarray(data[k]), k
            raise HTTPException(400, f"No sequence-shaped array in {resolved.name} (keys={list(data.files)})")
        if key not in data.files:
            raise HTTPException(404, f"Key not found: {key} (have {list(data.files)})")
        return np.asarray(data[key]), key
    if ext in (".h5", ".hdf5"):
        import h5py
        with h5py.File(str(resolved), "r") as f:
            if not key:
                found = {"name": None}

                def visit(name, obj):
                    if found["name"] is not None:
                        return
                    if isinstance(obj, h5py.Dataset) and _is_sequence_shape(obj.shape):
                        found["name"] = name

                f.visititems(visit)
                if found["name"] is None:
                    raise HTTPException(400, "No sequence-shaped dataset in h5 file")
                key = found["name"]
            if key not in f:
                raise HTTPException(404, f"Key not found: {key}")
            ds = f[key]
            return np.asarray(ds[...]), key
    raise HTTPException(400, f"Unsupported extension: {ext}")


@router.get("/api/export_mp4")
async def export_mp4(
    path: str = Query(..., description="Absolute path to .npy/.npz/.h5/.hdf5"),
    key: str | None = Query(None, description="Optional dataset key for .npz / .h5"),
    fps: int = Query(10, ge=1, le=120),
):
    if not shutil.which("ffmpeg"):
        raise HTTPException(500, "ffmpeg is not installed; run reproduce_env.sh")

    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(400, "Path is not a file")
    if resolved.suffix.lower() not in _SUPPORTED_EXTS:
        raise HTTPException(400, f"Cannot export {resolved.suffix} to mp4")

    arr, used_key = _load_array(resolved, key)
    frames = _to_rgb_uint8_stack(arr)
    n, h, w, _c = frames.shape

    stat = resolved.stat()
    cache_key = hashlib.md5(
        f"{resolved}|{used_key}|{stat.st_mtime}|{fps}|{n}x{h}x{w}".encode()
    ).hexdigest()
    out_path = _VIDEO_CACHE_DIR / f"export_{cache_key}.mp4"

    if not out_path.exists():
        tmp = out_path.with_suffix(".tmp.mp4")
        cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{w}x{h}",
            "-framerate", str(fps),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-loglevel", "error",
            str(tmp),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # Feed in batches; drain after each so the pipe buffer doesn't stall.
        BATCH = 32
        try:
            for i in range(0, n, BATCH):
                proc.stdin.write(frames[i:i + BATCH].tobytes())
                await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass
        _, stderr = await proc.communicate()
        if proc.returncode != 0 or not tmp.exists():
            tmp.unlink(missing_ok=True)
            raise HTTPException(500, f"ffmpeg failed: {stderr.decode(errors='replace')[:500]}")
        tmp.rename(out_path)

    safe_key = used_key.replace("/", "_").replace("\\", "_") or "export"
    filename = f"{resolved.stem}_{safe_key}_{fps}fps.mp4"
    return FileResponse(str(out_path), media_type="video/mp4", filename=filename)
