"""USD animated point-cloud API.

Endpoints:
  GET /api/usd/meta?path=...         → scene/time metadata + bounding box
  GET /api/usd/frame?path=...&time=T → binary positions + colors for one time sample

Binary frame format (little-endian):
  uint32  n_points
  float32 positions[n_points * 3]   (x, y, z)
  uint8   colors[n_points * 3]      (r, g, b)
"""
import os
import struct
import asyncio
from collections import OrderedDict
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, JSONResponse

import numpy as np
from pxr import Usd, UsdGeom

from api.directory import _safe_resolve

router = APIRouter()

# LRU-ish cache of open USD stages: (abs_path, mtime) → Stage
# Opening a large USDC is fast (pxr reads the index lazily), but we still
# avoid reopening when the client scrubs through frames.
_STAGE_CACHE: "OrderedDict[tuple[str, float], Usd.Stage]" = OrderedDict()
_STAGE_CACHE_MAX = 4


def _get_stage(path: str) -> Usd.Stage:
    mtime = os.path.getmtime(path)
    key = (path, mtime)
    if key in _STAGE_CACHE:
        _STAGE_CACHE.move_to_end(key)
        return _STAGE_CACHE[key]

    stage = Usd.Stage.Open(path)
    if stage is None:
        raise HTTPException(status_code=400, detail="Failed to open USD stage")

    _STAGE_CACHE[key] = stage
    if len(_STAGE_CACHE) > _STAGE_CACHE_MAX:
        _STAGE_CACHE.popitem(last=False)
    return stage


def _find_points_prim(stage: Usd.Stage):
    """Return the first UsdGeomPoints prim, or None."""
    for prim in stage.TraverseAll():
        if prim.GetTypeName() == "Points":
            return UsdGeom.Points(prim)
    return None


def _find_mesh_prims(stage: Usd.Stage):
    return [prim for prim in stage.TraverseAll() if prim.GetTypeName() == "Mesh"]


def _compute_meta_sync(resolved_path: str) -> dict:
    stage = _get_stage(resolved_path)
    points = _find_points_prim(stage)
    meshes = _find_mesh_prims(stage)

    start = float(stage.GetStartTimeCode())
    end = float(stage.GetEndTimeCode())
    fps = float(stage.GetTimeCodesPerSecond() or 24.0)
    up_axis = UsdGeom.GetStageUpAxis(stage)

    if points is None:
        return {
            "is_time_sampled": False,
            "prim_type": "Mesh" if meshes else "none",
            "n_mesh_prims": len(meshes),
            "start_time": start,
            "end_time": end,
            "fps": fps,
            "up_axis": up_axis,
        }

    pos_attr = points.GetPointsAttr()
    times = list(pos_attr.GetTimeSamples())
    is_animated = len(times) > 0

    color_attr = points.GetDisplayColorAttr()
    has_colors = color_attr.HasValue() or color_attr.GetNumTimeSamples() > 0

    # Sample first frame to get point count + bbox
    sample_time = Usd.TimeCode(times[0]) if is_animated else Usd.TimeCode.Default()
    positions_vt = pos_attr.Get(sample_time)
    n_points = len(positions_vt) if positions_vt is not None else 0

    bbox_min = [0.0, 0.0, 0.0]
    bbox_max = [0.0, 0.0, 0.0]
    if n_points > 0:
        arr = np.asarray(positions_vt, dtype=np.float32)
        bbox_min = arr.min(axis=0).tolist()
        bbox_max = arr.max(axis=0).tolist()

    return {
        "is_time_sampled": is_animated,
        "prim_type": "Points",
        "prim_path": str(points.GetPrim().GetPath()),
        "start_time": start,
        "end_time": end,
        "fps": fps,
        "up_axis": up_axis,
        "n_frames": len(times),
        "times": times,
        "has_colors": has_colors,
        "n_points_first_frame": n_points,
        "bbox_min": bbox_min,
        "bbox_max": bbox_max,
    }


@router.get("/api/usd/meta")
async def usd_meta(path: str = Query(...)):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    try:
        data = await asyncio.to_thread(_compute_meta_sync, str(resolved))
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"USD meta failed: {e}")


def _compute_frame_sync(resolved_path: str, time: float) -> bytes:
    stage = _get_stage(resolved_path)
    points = _find_points_prim(stage)
    if points is None:
        raise HTTPException(status_code=400, detail="No UsdGeomPoints prim in stage")

    tc = Usd.TimeCode(time)
    positions_vt = points.GetPointsAttr().Get(tc)
    if positions_vt is None:
        return struct.pack("<I", 0)

    positions = np.ascontiguousarray(np.asarray(positions_vt, dtype=np.float32))
    n = positions.shape[0]

    colors_vt = points.GetDisplayColorAttr().Get(tc)
    if colors_vt is not None and len(colors_vt) == n:
        colors_f32 = np.asarray(colors_vt, dtype=np.float32)
        colors = (np.clip(colors_f32, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    elif colors_vt is not None and len(colors_vt) == 1:
        c = (np.clip(np.asarray(colors_vt[0], dtype=np.float32), 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
        colors = np.broadcast_to(c, (n, 3)).copy()
    else:
        colors = np.full((n, 3), 200, dtype=np.uint8)

    header = struct.pack("<I", n)
    return header + positions.tobytes() + colors.tobytes()


@router.get("/api/usd/frame")
async def usd_frame(
    path: str = Query(...),
    time: float = Query(0.0, description="USD time code"),
):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    try:
        buf = await asyncio.to_thread(_compute_frame_sync, str(resolved), time)
        return Response(
            content=buf,
            media_type="application/octet-stream",
            headers={"Cache-Control": "public, max-age=60"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"USD frame failed: {e}")
