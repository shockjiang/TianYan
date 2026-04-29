"""API for previewing HDF5 (.h5/.hdf5) files: dataset tree, attrs, and image frames."""

import numpy as np
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, JSONResponse
from api.directory import _safe_resolve
from api.npy import _array_to_png

router = APIRouter()


def _attr_to_json(v):
    """Convert an HDF5 attribute value to JSON-friendly form."""
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            return f"<bytes len={len(v)}>"
    if isinstance(v, np.ndarray):
        if v.dtype.kind == "S":
            return [x.decode("utf-8", errors="replace") for x in v.flat][: 200]
        if v.size <= 200:
            return v.tolist()
        return {"shape": list(v.shape), "dtype": str(v.dtype), "preview": v.flat[:20].tolist()}
    if isinstance(v, np.generic):
        return v.item()
    return v


def _read_attrs(obj):
    return {k: _attr_to_json(v) for k, v in obj.attrs.items()}


def _looks_like_image_frames(shape, dtype):
    """Heuristic: shape resembles (N, H, W) or (N, H, W, C)."""
    if len(shape) == 3:
        # (N,H,W) or (H,W,C). Treat as frames if first dim isn't a channel count and last isn't.
        n, h, w = shape
        if w in (1, 3, 4) and h > 4 and n > 4:
            return False  # (H,W,C) single image
        return n > 1 and h > 4 and w > 4
    if len(shape) == 4:
        n, h, w, c = shape
        return c in (1, 3, 4) and n >= 1 and h > 4 and w > 4
    return False


def _is_visualizable(shape, dtype):
    """Is this dataset renderable as one or more PNG frames?"""
    nd = len(shape)
    if nd == 2:
        h, w = shape
        # Skip thin strips like (N, 5) which are clearly tabular, not images
        return h >= 8 and w >= 8
    if nd == 3:
        n, h, w = shape
        if w in (1, 3, 4) and h >= 8:
            return True  # (H, W, C) single image
        return n >= 1 and h >= 8 and w >= 8  # (N, H, W) frames
    if nd == 4:
        return shape[-1] in (1, 3, 4) and shape[1] >= 8 and shape[2] >= 8
    return False


def _summarize_dataset(name, ds):
    shape = list(ds.shape)
    dtype = str(ds.dtype)
    info = {
        "key": name,
        "shape": shape,
        "dtype": dtype,
        "ndim": ds.ndim,
        "size": int(np.prod(shape)) if shape else 1,
        "attrs": _read_attrs(ds),
        "visualizable": _is_visualizable(shape, ds.dtype),
        "is_frames": _looks_like_image_frames(shape, ds.dtype),
        "num_frames": None,
    }
    if info["is_frames"]:
        info["num_frames"] = int(shape[0])
    elif info["visualizable"] and len(shape) == 3 and shape[-1] not in (1, 3, 4):
        # (N,H,W) frame stack
        info["num_frames"] = int(shape[0])
        info["is_frames"] = True
    return info


def _walk(group, prefix=""):
    """Yield (full_key, dataset_summary) for every dataset in the file."""
    import h5py
    items = []
    for k in group:
        full = f"{prefix}/{k}" if prefix else k
        item = group[k]
        if isinstance(item, h5py.Dataset):
            items.append(_summarize_dataset(full, item))
        elif isinstance(item, h5py.Group):
            items.extend(_walk(item, full))
    return items


@router.get("/api/h5/info")
async def h5_info(path: str = Query(...)):
    """Return file-level attrs + flat list of all datasets with shape/dtype/attrs."""
    import h5py
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    if resolved.suffix.lower() not in (".h5", ".hdf5"):
        raise HTTPException(status_code=400, detail="Not an h5/hdf5 file")

    try:
        with h5py.File(str(resolved), "r") as f:
            datasets = _walk(f)
            return {
                "attrs": _read_attrs(f),
                "datasets": datasets,
                "num_datasets": len(datasets),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/api/h5/preview")
async def h5_preview(path: str = Query(...), key: str = Query(...), max_items: int = Query(200, ge=1, le=10000)):
    """Return small inline data for a non-image dataset (1D arrays, scalars, short tables)."""
    import h5py
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    try:
        with h5py.File(str(resolved), "r") as f:
            if key not in f:
                raise HTTPException(status_code=404, detail=f"Key not found: {key}")
            ds = f[key]
            if not hasattr(ds, "shape"):
                raise HTTPException(status_code=400, detail="Not a dataset")
            shape = list(ds.shape)
            size = int(np.prod(shape)) if shape else 1
            result = {
                "key": key,
                "shape": shape,
                "dtype": str(ds.dtype),
                "attrs": _read_attrs(ds),
            }
            if size == 0:
                result["data"] = []
            elif size <= max_items:
                arr = ds[...]
                result["data"] = _attr_to_json(arr)
            else:
                # Big array: head + stats
                if ds.ndim == 1:
                    head = ds[:max_items]
                else:
                    head = ds[: min(20, shape[0])]
                result["data_preview"] = _attr_to_json(np.asarray(head))
                if np.issubdtype(ds.dtype, np.number):
                    # Sample for stats to avoid loading huge arrays
                    sample_n = min(size, 1_000_000)
                    if ds.ndim == 1:
                        sample = ds[: sample_n]
                    else:
                        # Take first frames worth of data
                        sample = ds[: max(1, sample_n // max(1, int(np.prod(shape[1:]))))]
                    sample = np.asarray(sample)
                    result["min"] = float(np.nanmin(sample))
                    result["max"] = float(np.nanmax(sample))
                    result["mean"] = float(np.nanmean(sample))
                result["truncated"] = True
            return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/api/h5/frame")
async def h5_frame(
    path: str = Query(...),
    key: str = Query(..., description="Dataset path inside the h5 file"),
    frame: int = Query(0, ge=0),
):
    """Render a single frame (or single image) from an h5 dataset as PNG."""
    import h5py
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    try:
        with h5py.File(str(resolved), "r") as f:
            if key not in f:
                raise HTTPException(status_code=404, detail=f"Key not found: {key}")
            ds = f[key]
            if not hasattr(ds, "shape"):
                raise HTTPException(status_code=400, detail="Not a dataset")
            shape = ds.shape

            if ds.ndim == 2:
                frame_data = ds[...]
            elif ds.ndim == 3:
                # (H,W,C) single image vs (N,H,W) sequence
                if shape[2] in (1, 3, 4) and shape[0] > 4:
                    frame_data = ds[...]
                else:
                    idx = min(frame, shape[0] - 1)
                    frame_data = ds[idx]
            elif ds.ndim == 4:
                idx = min(frame, shape[0] - 1)
                frame_data = ds[idx]
            else:
                raise HTTPException(status_code=400, detail=f"Cannot visualize {ds.ndim}D dataset")

            png_bytes = _array_to_png(np.asarray(frame_data))
            return Response(
                content=png_bytes,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=300"},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
