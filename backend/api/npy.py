"""API for previewing .npy and .npz files as images or data."""

import io
import numpy as np
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response
from api.directory import _safe_resolve

router = APIRouter()

MAX_NPY_SIZE = 500 * 1024 * 1024  # 500MB


def _array_to_png(arr: np.ndarray) -> bytes:
    """Convert a 2D or 3D numpy array to PNG bytes."""
    from PIL import Image

    if arr.dtype == bool:
        img_data = (arr.astype(np.uint8) * 255)
    elif arr.dtype == np.uint8:
        img_data = arr
    elif np.issubdtype(arr.dtype, np.floating):
        mn, mx = arr.min(), arr.max()
        if mx > mn:
            img_data = ((arr - mn) / (mx - mn) * 255).astype(np.uint8)
        else:
            img_data = np.zeros_like(arr, dtype=np.uint8)
    elif np.issubdtype(arr.dtype, np.integer):
        mn, mx = float(arr.min()), float(arr.max())
        if mx > mn:
            img_data = ((arr.astype(np.float64) - mn) / (mx - mn) * 255).astype(np.uint8)
        else:
            img_data = np.zeros_like(arr, dtype=np.uint8)
    else:
        raise ValueError(f"Cannot visualize dtype {arr.dtype}")

    if img_data.ndim == 2:
        img = Image.fromarray(img_data, mode='L')
    elif img_data.ndim == 3 and img_data.shape[2] == 3:
        img = Image.fromarray(img_data, mode='RGB')
    elif img_data.ndim == 3 and img_data.shape[2] == 4:
        img = Image.fromarray(img_data, mode='RGBA')
    elif img_data.ndim == 3 and img_data.shape[2] == 1:
        img = Image.fromarray(img_data[:, :, 0], mode='L')
    else:
        raise ValueError(f"Cannot visualize shape {img_data.shape}")

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


@router.get("/api/npy/info")
async def npy_info(path: str = Query(...)):
    """Get metadata about an npy file without loading all data."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    ext = resolved.suffix.lower()
    try:
        if ext == '.npy':
            arr = np.load(str(resolved), mmap_mode='r')
            return {
                "shape": list(arr.shape),
                "dtype": str(arr.dtype),
                "ndim": arr.ndim,
                "size": int(np.prod(arr.shape)),
                "min": float(arr.min()) if arr.size < 10_000_000 else None,
                "max": float(arr.max()) if arr.size < 10_000_000 else None,
                "visualizable": arr.ndim in (2, 3),
                "num_frames": arr.shape[0] if arr.ndim == 3 and arr.shape[0] != 3 and arr.shape[0] != 4 else None,
            }
        elif ext == '.npz':
            data = np.load(str(resolved), allow_pickle=False)
            keys = list(data.keys())
            arrays = {}
            for k in keys[:20]:
                a = data[k]
                arrays[k] = {"shape": list(a.shape), "dtype": str(a.dtype)}
            return {
                "keys": keys,
                "arrays": arrays,
                "num_keys": len(keys),
                "visualizable": False,
            }
        else:
            raise HTTPException(status_code=400, detail=f"Not an npy/npz file: {ext}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/npy/frame")
async def npy_frame(
    path: str = Query(...),
    frame: int = Query(0, ge=0),
    key: str = Query(None, description="Key for npz files"),
):
    """Render a single frame from an npy array as PNG."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    try:
        ext = resolved.suffix.lower()
        if ext == '.npz':
            data = np.load(str(resolved), allow_pickle=False)
            if key is None:
                key = list(data.keys())[0]
            arr = data[key]
        else:
            arr = np.load(str(resolved), mmap_mode='r')

        # Select frame based on dimensionality
        if arr.ndim == 2:
            # Single 2D image
            frame_data = np.array(arr)
        elif arr.ndim == 3:
            # Could be (H,W,C) image or (N,H,W) sequence
            if arr.shape[2] in (1, 3, 4) and arr.shape[0] > 4:
                # Likely (H,W,C) — single image
                frame_data = np.array(arr)
            else:
                # (N,H,W) sequence
                if frame >= arr.shape[0]:
                    frame = arr.shape[0] - 1
                frame_data = np.array(arr[frame])
        elif arr.ndim == 4:
            # (N,H,W,C) sequence
            if frame >= arr.shape[0]:
                frame = arr.shape[0] - 1
            frame_data = np.array(arr[frame])
        else:
            raise HTTPException(status_code=400, detail=f"Cannot visualize {arr.ndim}D array")

        png_bytes = _array_to_png(frame_data)
        return Response(content=png_bytes, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=300"})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
