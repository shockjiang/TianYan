"""API for previewing tabular data files (.jsonl, .parquet)."""

import json
import os
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from api.directory import _safe_resolve

router = APIRouter()

MAX_CELL_LEN = 500  # Truncate long cell values for display


def _truncate(val):
    """Convert value to display string, truncating if too long."""
    if val is None:
        return None
    s = str(val)
    if len(s) > MAX_CELL_LEN:
        return s[:MAX_CELL_LEN] + "..."
    return s


def _make_serializable(val):
    """Make a value JSON-serializable."""
    if val is None or isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, bytes):
        return f"<bytes len={len(val)}>"
    if isinstance(val, (list, tuple)):
        if len(val) > 20:
            return [_make_serializable(v) for v in val[:20]] + [f"... ({len(val)} items)"]
        return [_make_serializable(v) for v in val]
    if isinstance(val, dict):
        return {str(k): _make_serializable(v) for k, v in list(val.items())[:20]}
    # numpy arrays, etc.
    try:
        import numpy as np
        if isinstance(val, np.ndarray):
            if val.size > 20:
                return f"<ndarray shape={val.shape} dtype={val.dtype}>"
            return val.tolist()
        if isinstance(val, (np.integer,)):
            return int(val)
        if isinstance(val, (np.floating,)):
            return float(val)
    except ImportError:
        pass
    return _truncate(val)


def _read_jsonl(path: Path, head_n: int, tail_n: int) -> dict:
    """Read head and tail records from a JSONL file."""
    # Count total lines and read head
    head_records = []
    total = 0
    tail_buffer = []

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            if total <= head_n:
                try:
                    head_records.append(json.loads(line))
                except json.JSONDecodeError:
                    head_records.append({"__raw__": _truncate(line)})
            # Keep a rolling buffer for tail
            if tail_n > 0:
                tail_buffer.append(line)
                if len(tail_buffer) > tail_n:
                    tail_buffer.pop(0)

    # Parse tail records
    tail_records = []
    if total > head_n:
        for line in tail_buffer:
            try:
                tail_records.append(json.loads(line))
            except json.JSONDecodeError:
                tail_records.append({"__raw__": _truncate(line)})
        # Remove overlap if file is small enough that head and tail overlap
        tail_start = total - len(tail_records)
        if tail_start < head_n:
            overlap = head_n - tail_start
            tail_records = tail_records[overlap:]

    # Collect all column names from head + tail
    columns = []
    seen = set()
    for rec in head_records + tail_records:
        if isinstance(rec, dict):
            for k in rec:
                if k not in seen:
                    columns.append(k)
                    seen.add(k)

    # Make all values serializable
    head_records = [{k: _make_serializable(v) for k, v in r.items()} if isinstance(r, dict) else r for r in head_records]
    tail_records = [{k: _make_serializable(v) for k, v in r.items()} if isinstance(r, dict) else r for r in tail_records]

    return {
        "total": total,
        "columns": columns,
        "head": head_records,
        "tail": tail_records,
        "head_n": len(head_records),
        "tail_n": len(tail_records),
        "format": "jsonl",
    }


def _read_parquet(path: Path, head_n: int, tail_n: int) -> dict:
    """Read head and tail records from a Parquet file.

    Only reads the row groups that contain the requested head/tail rows,
    avoiding full-file deserialization for large files.
    """
    import pyarrow.parquet as pq

    pf = pq.ParquetFile(str(path))
    meta = pf.metadata
    total = meta.num_rows
    columns = [col.name for col in pf.schema_arrow]

    # Build row-group offset map: [(start_row, num_rows), ...]
    rg_offsets = []
    offset = 0
    for i in range(meta.num_row_groups):
        n = meta.row_group(i).num_rows
        rg_offsets.append((offset, n))
        offset += n

    def _rows_to_records(row_start: int, row_count: int) -> list[dict]:
        """Read only the row groups covering [row_start, row_start+row_count)."""
        if row_count <= 0:
            return []
        row_end = row_start + row_count
        # Find which row groups overlap with [row_start, row_end)
        needed_rgs = []
        for rg_idx, (rg_start, rg_n) in enumerate(rg_offsets):
            rg_end = rg_start + rg_n
            if rg_end > row_start and rg_start < row_end:
                needed_rgs.append(rg_idx)
        if not needed_rgs:
            return []
        table = pf.read_row_groups(needed_rgs)
        # Compute local offset within the concatenated row groups
        first_rg_start = rg_offsets[needed_rgs[0]][0]
        local_start = row_start - first_rg_start
        sliced = table.slice(local_start, row_count)
        records = []
        for i in range(sliced.num_rows):
            row = {}
            for col in columns:
                row[col] = _make_serializable(sliced.column(col)[i].as_py())
            records.append(row)
        return records

    head_records = _rows_to_records(0, min(head_n, total))

    tail_records = []
    if total > head_n and tail_n > 0:
        tail_start = max(head_n, total - tail_n)
        tail_records = _rows_to_records(tail_start, total - tail_start)

    return {
        "total": total,
        "columns": columns,
        "head": head_records,
        "tail": tail_records,
        "head_n": len(head_records),
        "tail_n": len(tail_records),
        "format": "parquet",
        "num_row_groups": meta.num_row_groups,
    }


@router.get("/api/tabular")
async def get_tabular(
    path: str = Query(..., description="Absolute file path"),
    head_n: int = Query(50, ge=1, le=500),
    tail_n: int = Query(50, ge=0, le=500),
):
    """Preview tabular data (JSONL or Parquet) with head and tail records."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    ext = resolved.suffix.lower()

    try:
        if ext in (".jsonl", ".jsonlines"):
            return _read_jsonl(resolved, head_n, tail_n)
        elif ext in (".parquet", ".pq"):
            return _read_parquet(resolved, head_n, tail_n)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")
