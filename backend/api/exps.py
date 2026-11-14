"""Experiment browser for manifold_model runs (the /exps sub-page).

Status, loss, val MSE and probe MSE come from manifold_model's
framework/scripts/exp_board.py (imported by path), so the tmux board and this
page always agree. This module only adds what the page needs on top:
per-run metadata (version, commit, datasets, data/train tags) from config.json
and the full train-log curves.

    GET /api/exps                 one summary row per run + filter facets
    GET /api/exps/{exp}/curves    train log rows (every logged key) + val/probe per ckpt
"""
import importlib.util
import json
import os
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

MM = Path(os.environ.get("MANIFOLD_MODEL_ROOT", "/manifoldai-infra-infra/shock/manifold_model"))
_spec = importlib.util.spec_from_file_location("exp_board", MM / "framework/scripts/exp_board.py")
board = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(board)

router = APIRouter(prefix="/api/exps")

LIST_TTL = 10.0     # seconds a list result is reused
TASKS_TTL = 60.0    # mlp ml_task list is ~3 s, call it at most once a minute
_lock = threading.Lock()
_state = {"val": board.ValIndex(), "tasks": {}, "tasks_t": 0.0, "list": None, "list_t": 0.0}
_meta_cache = {}    # exp -> (config mtime, meta)

NAME_RE = re.compile(r"-TS(\d{4})[.]?(\d{4})-([0-9a-f]{7})")


def _name_meta(exp):
    m = NAME_RE.search(exp)
    version = re.match(r"(v\d+)", exp, re.I)
    return {
        "version": version.group(1).lower() if version else "-",
        "ts": f"{m.group(1)}.{m.group(2)}" if m else None,
        "commit": m.group(3) if m else None,
        "recipe": exp[:m.start()] if m else exp,
    }


def _d(x):
    """Config fields were bools in older runs and dicts in newer ones."""
    return x if isinstance(x, dict) else {}


def _tags(cfg):
    """Data-processing and training tags read from the saved config (no hand labelling)."""
    ds = cfg.get("train_dataloader", {}).get("dataset", {}) or {}
    model = cfg.get("model", {}) or {}
    runner = cfg.get("runner", {}) or {}
    data, train = [], []
    if ds.get("action_type"):
        data.append(f"action:{ds['action_type']}")
    if ds.get("bbox_overlay"):
        data.append("bbox_overlay" + ("+track" if _d(ds["bbox_overlay"]).get("track") else ""))
    if ds.get("static_filter"):
        data.append("static_filter")
    if ds.get("view_dropout"):
        data.append("view_dropout:" + ",".join(_d(ds["view_dropout"]).get("cameras", [])))
    if ds.get("episode_state_dropout"):
        data.append("state_dropout")
    if ds.get("skill_dropout_prob"):
        data.append(f"skill_dropout={ds['skill_dropout_prob']}")
    if ds.get("data_sample_stride"):
        data.append(f"stride={ds['data_sample_stride']}")
    if ds.get("action_sources"):
        data.append("action_sources")
    if ds.get("clip_segment_end"):
        data.append("clip_segment_end")
    if ds.get("rtc_transforms") or "rtc" in json.dumps(ds.get("transforms", [])).lower():
        data.append("rtc_transforms")
    train.append(f"model:{model.get('type', '?')}")
    if model.get("freeze_vision"):
        train.append("freeze_vision")
    aug = model.get("batch_augmentation")
    if aug and not isinstance(aug, dict):  # older configs: a plain on/off flag
        train.append("aug:on")
    aug = _d(aug)
    for k in ("crop_cameras", "rotate_cameras", "motion_blur", "random_erasing", "color_jitter"):
        if aug.get(k):
            train.append(f"aug:{k.replace('_cameras', '')}")
    for head in ("skill_head", "progress_head", "inverse_head", "gripper_head", "aux_pool"):
        if model.get(head):
            train.append(head)
    pre = str(model.get("pretrained_model") or "")
    parent = re.search(r"work_dirs/([^/]+)/checkpoints/(\d+)", pre)
    train.append(f"init:{parent.group(1)}@{parent.group(2)}" if parent else "init:base")
    opt = runner.get("optimizer", {}) or {}
    if opt.get("lr") is not None:
        train.append(f"lr={opt['lr']:g}")
    bs = cfg.get("train_dataloader", {}).get("per_device_batch_size")
    if bs:
        train.append(f"bs/dev={bs}")
    return data, train, (f"{parent.group(1)}@{parent.group(2)}" if parent else None)


def _meta(exp):
    d = MM / "work_dirs" / exp
    cfg_path = d / "config.json"
    if not cfg_path.exists():
        return {**_name_meta(exp), "datasets": [], "data_tags": [], "train_tags": [], "parent": None}
    mtime = cfg_path.stat().st_mtime
    hit = _meta_cache.get(exp)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        cfg = json.loads(cfg_path.read_text())
    except ValueError:
        cfg = {}
    ds = cfg.get("train_dataloader", {}).get("dataset", {}) or {}
    paths = ds.get("data_path") or []
    paths = [paths] if isinstance(paths, str) else paths
    data_tags, train_tags, parent = _tags(cfg)
    meta = {
        **_name_meta(exp),
        "datasets": list(dict.fromkeys(Path(p).stem for p in paths)),  # repeats = sampling weight
        "dataset_paths": paths,
        "data_tags": data_tags,
        "train_tags": train_tags,
        "parent": parent,
        "lr": (cfg.get("runner", {}).get("optimizer", {}) or {}).get("lr"),
        "batch_per_device": cfg.get("train_dataloader", {}).get("per_device_batch_size"),
        "config_path": str(cfg_path),
        "work_dir": str(d),
    }
    _meta_cache[exp] = (mtime, meta)
    return meta


def _rows():
    with _lock:
        now = time.time()
        if _state["list"] is not None and now - _state["list_t"] < LIST_TTL:
            return _state["list"]
        if now - _state["tasks_t"] > TASKS_TTL:
            _state["tasks"], _state["tasks_t"] = board.mlp_tasks(), now
        rows = board.collect(_state["val"], _state["tasks"])
        for r in rows:
            r.update(_meta(r["exp"]))
        _state["list"], _state["list_t"] = rows, now
        return rows


HIDDEN_FILE = Path(__file__).resolve().parent.parent / "exps_hidden.json"


def hidden_patterns():
    """Name substrings hidden from the page (backend/exps_hidden.json); the runs' files are untouched."""
    try:
        return json.loads(HIDDEN_FILE.read_text()).get("patterns", [])
    except (OSError, ValueError):
        return []


def rows_with_tags():
    """_rows() minus hidden runs, plus the user / Claude tags (read fresh every call, never cached)."""
    from api.exp_tags import load_tags
    store, hidden = load_tags(), hidden_patterns()
    return [{**r, "tags": [t["tag"] for t in store.get(r["exp"], [])], "tag_info": store.get(r["exp"], [])}
            for r in _rows() if not any(p in r["exp"] for p in hidden)]


@router.get("")
def list_exps():
    rows = rows_with_tags()

    def facet(key):
        vals = {}
        for r in rows:
            for v in (r.get(key) if isinstance(r.get(key), list) else [r.get(key)]):
                if v not in (None, "-"):
                    vals[v] = vals.get(v, 0) + 1
        return sorted(vals.items(), key=lambda kv: (-kv[1], str(kv[0])))

    return {
        "updated": time.time(),
        "rows": rows,
        "hidden": {"patterns": hidden_patterns(), "count": len(_rows()) - len(rows)},
        "facets": {k: facet(k) for k in ("version", "datasets", "data_tags", "train_tags", "tags", "status")},
    }


@router.get("/{exp}/curves")
def curves(exp: str):
    d = MM / "work_dirs" / exp
    if "/" in exp or not d.is_dir():
        raise HTTPException(404, f"no such experiment: {exp}")
    _, rows = board.train_log(d)
    val = _state["val"].refresh()
    val_rows = [{"step": s, "set": label, "mse": mse, "joint_raw": raw}
                for (e, s), entries in sorted(val.items()) if e == exp for label, mse, raw in entries]
    return {
        "exp": exp,
        "train": rows,
        "keys": sorted({k for r in rows for k, v in r.items() if isinstance(v, (int, float))} - {"step", "epoch"}),
        "val": val_rows,
        "probe": board.probe_rows(exp),
        "checkpoints": board.checkpoints(d),
    }
