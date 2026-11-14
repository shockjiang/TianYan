"""API for previewing lm_batch training dumps: debug_dumps/lm_step_*.h5 (and legacy step_*.h5)."""

import json
import math
import re
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, JSONResponse

from api.directory import _safe_resolve
from api.npy import _array_to_png

router = APIRouter()

# FALLBACK ONLY, for dumps that do not record their own layout. The current writer
# emits root state_dim_names/action_dim_names; whenever it does, the FILE wins
# (_file_dim_names). Renaming these would silently relabel every older dump.
# Spec: docs/lm_batch.md "Units and denormalization". The state layout puts both
# grippers last; the action layout interleaves left_grip after the left arm and
# right_grip at the end. These are NOT interchangeable.
STATE_DIM_NAMES = [
    "base_vx", "base_vy", "base_wz", "waist_yaw", "waist_pitch", "torso_pad0", "torso_pad1",
    "L_SH_P", "L_SH_R", "L_SH_Y", "L_ELB_Y", "L_WR_P", "L_WR_Y", "L_WR_R",
    "R_SH_P", "R_SH_R", "R_SH_Y", "R_ELB_Y", "R_WR_P", "R_WR_Y", "R_WR_R",
    "left_grip", "right_grip",
]  # len 23

ACTION_DIM_NAMES = [
    "base_vx", "base_vy", "base_wz", "waist_yaw", "waist_pitch", "torso_pad0", "torso_pad1",
    "L_SH_P", "L_SH_R", "L_SH_Y", "L_ELB_Y", "L_WR_P", "L_WR_Y", "L_WR_R", "left_grip",
    "R_SH_P", "R_SH_R", "R_SH_Y", "R_ELB_Y", "R_WR_P", "R_WR_Y", "R_WR_R", "right_grip",
]  # len 23

# The 23->32 model padding the writer appends. Deliberately NOT torso_pad0/torso_pad1,
# which are real slots inside the embodiment width.
_PAD_RE = re.compile(r"^pad\d+$")

# The real norm_stats.json is ~5KB. The override path bypasses _safe_resolve
# by design, so cap it before json.load() reads the whole file into memory.
MAX_NORM_STATS_SIZE = 8 * 1024 * 1024

_REJECT_DETAIL = (
    "Not an LM dump (debug_dumps/lm_step_*.h5, legacy step_*.h5): expected root attrs "
    "step/config and either <split>/output/pred_actions + <split>/model_input/prompt_text, "
    "or a batch-only dump with batch/model_input/prompt_text"
)

# Every image stage token the frame route accepts -> its h5 subpath inside a view
# group. "original"/"model_input" keep the exact meaning and path they have had
# since the first version, so bookmarked /api/lm/frame URLs never break.
_STAGE_PATH = {
    "original":           "original/images",
    "model_input":        "model_input/images",
    "model_input_preaug": "model_input/images_preaug",
    "model_input_aug":    "model_input/images_aug",
}

# Display order for the config/ recipe attrs. The lr_*/opt_* tail is enumerated by
# the writer from dataclass fields, so the key set is NOT fixed (38..41+); keys not
# listed here are bucketed by prefix, everything else lands in "other".
_CONFIG_GROUPS = [
    # The writer's doc_* keys are one-line self-describing sentences covering the whole
    # augmentation surface. Pipeline order, not alphabetical.
    ("recipe notes", ["doc_where_image_aug_runs", "doc_original_group", "doc_crop_rotate",
                      "doc_color_jitter", "doc_random_erase", "doc_state_noise", "doc_action_noise",
                      "doc_mirror", "doc_time_scale", "doc_skill_dropout", "doc_skill_swap",
                      "doc_clock_dropout", "doc_prompt_intact"]),
    ("identity",     ["exp_name", "config_name", "seed"]),
    ("schedule",     ["num_train_steps", "global_batch_size", "save_interval",
                      "val_snapshot_interval", "debug_dump_interval", "debug_dump_samples"]),
    ("model",        ["model_type", "action_horizon", "action_dim", "max_token_len",
                      "skill_vocab", "skill_loss_weight"]),
    ("augmentation", ["aug_image", "aug_crop_rotate_jitter", "aug_ops", "aug_random_erasing",
                      "aug_erasing_area", "aug_state_noise_std", "aug_state_noise_mode",
                      "aug_action_noise_std", "aug_mirror_prob", "aug_time_scale",
                      "aug_skill_dropout_prob", "aug_skill_swap_prob", "aug_skill_time_dropout_prob"]),
    ("data",         ["repo_ids", "sample_weights", "norm_stats_asset_id",
                      "skill_prompt_template", "skill_time_template"]),
    ("optimizer",    ["lr_schedule", "optimizer"]),
]


def _file_dim_names(f) -> dict | None:
    """Root state_dim_names/action_dim_names, decoded. None when the dump has none.

    -> {"state", "action", "padded_len", "real_len", "warning"}. A warning never
    disqualifies the lists: the file is still more authoritative than a guess.
    """
    import h5py
    try:
        sd, ad = f.get("state_dim_names"), f.get("action_dim_names")
        if not isinstance(sd, h5py.Dataset) or not isinstance(ad, h5py.Dataset):
            return None
        if sd.ndim != 1 or ad.ndim != 1 or sd.shape[0] == 0 or ad.shape[0] == 0:
            return None
        # h5py 3.x hands back bytes for a vlen utf-8 dataset; decoding is mandatory.
        state = [_decode(v) for v in sd[...]]
        action = [_decode(v) for v in ad[...]]

        def pref(lst):
            for k, nm in enumerate(lst):
                if _PAD_RE.match(nm):
                    return k
            return len(lst)

        warn = []
        if len(state) != len(action):
            warn.append(f"state_dim_names has {len(state)} entries, "
                        f"action_dim_names has {len(action)}")
        ps, pa = pref(state), pref(action)
        if ps != pa:
            warn.append(f"state names list {ps} real dims, action names list {pa}")
        for which, lst, p in (("state", state, ps), ("action", action, pa)):
            if any(not _PAD_RE.match(nm) for nm in lst[p:]):
                warn.append(f"pad names are not trailing in {which}_dim_names")
        padded_len = min(len(state), len(action))
        real_len = min(ps, pa)
        known = set(state[:real_len])
        missing = [nm for nm in action[:real_len] if nm not in known]
        if missing:
            warn.append("names present in action_dim_names but not state_dim_names: "
                        + ", ".join(missing[:4]))
        for which, lst in (("state", state), ("action", action)):
            seen = set()
            for nm in lst:
                if nm in seen:
                    warn.append(f"duplicate slot names in {which}_dim_names: {nm}")
                    break
                seen.add(nm)
        return {
            "state": state, "action": action,
            "padded_len": padded_len, "real_len": real_len,
            "warning": "; ".join(warn) if warn else None,
        }
    except Exception:
        # A malformed names dataset degrades to the fallback; it never 500s.
        return None


def _resolve_dim_real(f, g, dim_padded, names, is_batch) -> tuple[int | None, str | None]:
    """Real (unpadded) width of one view + where that number came from."""
    out, src = None, None
    d = _dim_real(g, None)
    if d is not None:                                   # 1. this view's own original/
        out, src = d, "original"
    elif is_batch:                                      # 2. inherit from a split
        for s in _splits(f):
            d = _dim_real(f[s], None)
            if d is not None:
                out, src = d, s
                break
    if out is None and names is not None and names["real_len"]:
        out, src = names["real_len"], "dim_names"       # 3. the file's own layout
    if out is None and is_batch and dim_padded:
        out, src = min(dim_padded, len(ACTION_DIM_NAMES)), "assumed_ti5"   # 4.
    if out is None and not is_batch and dim_padded is not None:
        out, src = dim_padded, "padded"                 # 5.
    if out is not None and dim_padded is not None:
        out = min(out, dim_padded)                      # clamp; the source is unchanged
    return out, src


def _dim_layout(names, dim_real, dim_padded, dim_real_from=None) -> dict:
    """Provenance block for the slot names. state/action are the FULL padded lists."""
    if names is not None:
        # The file's own list and the resolved width can disagree: original/actions
        # (precedence 1) or a split (2) both outrank the names. The labels then still
        # come from the file but describe a different number of real slots, so slots
        # past real_len read as "padN" while carrying data. Say so instead of hiding
        # them: the badge colour keys off warning != null, so it stops rendering in
        # the "the file told me these names" colour. Truncating the list instead
        # would blank the plot whenever real_len is the smaller number.
        warn = names["warning"]
        real = names["real_len"]
        if dim_real is not None and real is not None and dim_real != real:
            extra = (f"the dump's dim-name lists describe {real} real slot(s) but dim_real "
                     f"resolved to {dim_real}"
                     + (f" from {dim_real_from}" if dim_real_from else "")
                     + (f" — slots {real}..{dim_real - 1} are labelled as padding"
                        if dim_real > real else
                        f" — slots {dim_real}..{real - 1} are named but not shown"))
            warn = f"{warn}; {extra}" if warn else extra
        return {
            "source": "file",
            "state": list(names["state"]),
            "action": list(names["action"]),
            "padded_len": names["padded_len"],
            "real_len": names["real_len"],
            "note": ("slot names read from the dump's own state_dim_names/action_dim_names "
                     f"({names['real_len']} real of {names['padded_len']} slots)"),
            "warning": warn,
        }
    if dim_real == 23:
        return {
            "source": "assumed_ti5", "state": None, "action": None,
            "padded_len": dim_padded, "real_len": dim_real,
            "note": "this dump records no slot names — labels are the viewer's built-in ti5 layout",
            "warning": ("slot names are NOT in this file: the labels are assumed and are wrong "
                        "for any other embodiment"),
        }
    return {
        "source": "generic", "state": None, "action": None,
        "padded_len": dim_padded, "real_len": dim_real,
        "note": "this dump records no slot names — slots are shown by index",
        "warning": "slots are unnamed",
    }


def _sliced_dim_names(layout: dict, dim_real: int | None) -> tuple[list[str], list[str]]:
    """(action, state) names of length dim_real, in FILE ORDER.

    A trailing-suffix cut only: it drops pad23..pad31 (where gt is exactly 0 and
    pred_actions is model garbage) and leaves every remaining index equal to its
    file index. torso_pad0/1 are real slots and stay in position.
    """
    if dim_real is None:
        return [], []
    if layout["source"] == "file":
        return list(layout["action"][:dim_real]), list(layout["state"][:dim_real])
    if layout["source"] == "assumed_ti5":
        return list(ACTION_DIM_NAMES[:dim_real]), list(STATE_DIM_NAMES[:dim_real])
    generic = [f"dim_{i}" for i in range(dim_real)]
    return list(generic), list(generic)


def _jf(x):
    """One float leaf -> JSON-safe. NaN/inf become null."""
    f = float(x)
    return f if math.isfinite(f) else None


def _jl(arr):
    """np.ndarray (any rank) -> nested Python lists, non-finite -> None."""
    a = np.asarray(arr, dtype=np.float64)
    out = a.tolist()

    def scrub(v):
        if isinstance(v, list):
            return [scrub(x) for x in v]
        return v if math.isfinite(v) else None

    return scrub(out)


def _row(ds, i: int):
    """ds[i] when the dataset actually covers row i, else None.

    Per-sample datasets in one dump can disagree in length (_num_samples reports the
    first one it finds). A short one degrades to a missing field, never a 500.
    """
    if ds is None:
        return None
    shape = getattr(ds, "shape", None)
    if not shape or i >= shape[0]:
        return None
    return ds[i]


def _decode(v) -> str:
    """One h5 vlen string element -> str."""
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return str(v)


def _open_lm(resolved: Path):
    """Open + validate an LM dump. Returns an open h5py.File. Raises HTTPException."""
    import h5py

    try:
        f = h5py.File(str(resolved), "r")
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Not a readable HDF5 file: {e}")

    try:
        if "step" not in f.attrs or "config" not in f.attrs:
            raise HTTPException(status_code=400, detail=_REJECT_DETAIL)
        splits = [k for k in ("train", "val") if isinstance(f.get(k), h5py.Group)]
        if splits:
            s = splits[0]
            if (f.get(f"{s}/output/pred_actions") is None
                    or f.get(f"{s}/model_input/prompt_text") is None):
                raise HTTPException(status_code=400, detail=_REJECT_DETAIL)
        # Batch-only dump: the writer can emit config/ + batch/ with no per-split
        # sampling at all. That is a valid LM dump, just one with a single view.
        elif not any(isinstance(f.get(b), h5py.Group)
                     and f.get(f"{b}/model_input/prompt_text") is not None
                     for b in ("batch", "val_batch")):
            raise HTTPException(status_code=400, detail=_REJECT_DETAIL)
    except BaseException:
        f.close()
        raise
    return f


def _splits(f) -> list[str]:
    import h5py
    return [k for k in ("train", "val") if isinstance(f.get(k), h5py.Group)]


def _view_names(f) -> list[str]:
    """Every group /api/lm/sample and /api/lm/frame will address."""
    import h5py
    names = _splits(f)
    for b in ("batch", "val_batch"):
        if isinstance(f.get(b), h5py.Group):
            names.append(b)
    return names


def _attr_scalar(v):
    """One h5 attr -> JSON-safe. np.bool_/np.int64/np.float64/bytes/0-d ndarray all land here."""
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    if isinstance(v, np.ndarray):
        return [_attr_scalar(x) for x in v.ravel().tolist()]
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, bool):
        return v            # BEFORE int: bool is an int subclass
    if isinstance(v, (int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    return str(v)


def _attr_int(g, key) -> int | None:
    v = g.attrs.get(key)
    if v is None:
        return None
    try:
        return int(np.asarray(v).ravel()[0])
    except (TypeError, ValueError, IndexError):
        return None


def _config_kv(f) -> dict | None:
    """The config/ group's attrs, JSON-safe. None on a dump that has no config/ group."""
    import h5py
    g = f.get("config")
    if not isinstance(g, h5py.Group):
        return None
    return {str(k): _attr_scalar(v) for k, v in g.attrs.items()}


def _config_groups(kv: dict | None) -> list[dict]:
    """Ordered display groups. Table order first, then unknown keys by prefix, "other" last."""
    if not kv:
        return []
    remaining = set(kv)
    buckets: list[list] = []
    for name, keys in _CONFIG_GROUPS:
        present = [k for k in keys if k in remaining]
        remaining.difference_update(present)
        buckets.append([name, present])
    index = {name: keys for name, keys in buckets}
    other: list[str] = []
    for k in sorted(remaining):
        if k.startswith("doc_"):
            index["recipe notes"].append(k)
        elif k.startswith("aug_"):
            index["augmentation"].append(k)
        elif k.startswith("lr_") or k.startswith("opt_"):
            index["optimizer"].append(k)
        else:
            other.append(k)
    out = [{"name": name, "keys": keys} for name, keys in buckets if keys]
    if other:
        out.append({"name": "other", "keys": other})
    return out


def _generation(f) -> str:
    """Which of the three dump generations this is. Structural, never the filename."""
    import h5py
    if isinstance(f.get("config"), h5py.Group):
        return "G2"
    for s in _splits(f):
        if isinstance(f.get(f"{s}/model_input/images_aug"), h5py.Group):
            return "G1"
    return "G0"


def _aug_image(f) -> bool | None:
    """config/aug_image. None when the dump does not record it (G0)."""
    import h5py
    g = f.get("config")
    # The current writer renamed this to aug_crop_rotate_jitter (image_aug is a
    # bundle: crop+resize+rotate on non-wrist cams AND jitter on all three).
    for key in ("aug_image", "aug_crop_rotate_jitter"):
        if isinstance(g, h5py.Group) and key in g.attrs:
            v = _attr_scalar(g.attrs[key])
            if isinstance(v, (bool, int, float)):
                return bool(v)
            return None
    return True if _generation(f) == "G1" else None


def _aug_key(f) -> str | None:
    """Which config/ attr records the image-augmentation switch on THIS dump."""
    import h5py
    g = f.get("config")
    if isinstance(g, h5py.Group):
        for key in ("aug_crop_rotate_jitter", "aug_image"):
            if key in g.attrs:
                return key
    return None


def _off_tag(f) -> str:
    """How user-facing copy should name "augmentation is off" on this dump."""
    key = _aug_key(f)
    return f"{key}=False" if key else "image augmentation off"


def _cams(g, sub: str) -> list[dict] | None:
    """sorted [{name, shape, dtype}] for one image group, or None when it is absent.

    Touches links and .shape only: no pixel data is read.
    """
    import h5py
    grp = g.get(sub)
    if not isinstance(grp, h5py.Group):
        return None
    out = []
    for cam in sorted(grp.keys()):
        ds = grp.get(cam)
        # 0 in shape: renders to nothing, so do not offer a dead column at all.
        if not isinstance(ds, h5py.Dataset) or ds.ndim not in (3, 4) or 0 in ds.shape:
            continue
        out.append({
            "name": cam,
            "shape": [int(x) for x in ds.shape],
            "dtype": str(ds.dtype),
        })
    return out


def _stages(g, kind: str, gen: str, aug: bool | None,
            off_tag: str = "image augmentation off") -> list[dict]:
    """Image stages of one view, in pipeline order.

    A stage is emitted only if its group exists AND holds at least one renderable
    camera: an empty images_preaug/ would otherwise spend a whole default-on
    column on placeholders and push a stage that does have frames behind a chip.
    """
    if kind == "batch" and _cams(g, _STAGE_PATH["original"]):
        # The current writer records original/ INSIDE the batch group: the frame
        # before in-model augmentation, which is also what sample_actions ran on,
        # so pred_actions corresponds to it and not to the post-aug frame beside it.
        if aug is False:
            spec = [
                ("original", "original",
                 "before in-model augmentation — pred_actions was sampled from this; "
                 "augmentation is off, so this column is byte-identical to post-aug", True, True),
                ("model_input", "post-aug",
                 f"what the vision encoder trained on — byte-identical to original ({off_tag})",
                 False, True),
            ]
        else:
            spec = [
                ("original", "original",
                 "before in-model augmentation — pred_actions was sampled from this", True, True),
                ("model_input", "post-aug", "what the vision encoder trained on", False, True),
            ]
    elif kind == "batch":
        # batch/model_input/images_preaug is written UNCONDITIONALLY by the writer,
        # so probe for it -- never infer its presence from aug_image.
        if aug is False:
            spec = [
                ("model_input_preaug", "pre-aug", "aug_image=False — byte-identical to post-aug", False, False),
                ("model_input", "post-aug", "aug_image=False — byte-identical to pre-aug", False, True),
            ]
        elif aug is None:
            spec = [
                ("model_input_preaug", "pre-aug", "augmentation state not recorded", False, True),
                ("model_input", "post-aug", "augmentation state not recorded", False, True),
            ]
        else:
            spec = [
                ("model_input_preaug", "pre-aug", "the real batch before augmentation", False, True),
                ("model_input", "post-aug", "what the vision encoder trained on", False, True),
            ]
    elif gen == "G2":
        if _cams(g, _STAGE_PATH["model_input_preaug"]):
            spec = [
                ("original", "original", "raw dataset frame", False, False),
                ("model_input_preaug", "pre-aug", "pred_actions was sampled from this", True, True),
                ("model_input", "post-aug", "what the vision encoder trained on", False, True),
            ]
        else:
            spec = [
                ("original", "original", "raw dataset frame", False, True),
                ("model_input", "model_input",
                 "aug_image=False — pre-aug and post-aug are identical", True, True),
            ]
    elif gen == "G1":
        spec = [
            ("original", "original", "raw dataset frame", False, False),
            ("model_input", "pre-aug", "pred_actions was sampled from this", True, True),
            ("model_input_aug", "post-aug", "what the vision encoder trained on", False, True),
        ]
    else:  # G0 -- every file written before the format change
        spec = [
            ("original", "original", "raw dataset frame", False, True),
            ("model_input", "model_input",
             "pre-augmentation — this dump has no post-aug frames", True, True),
        ]

    out = []
    for sid, label, note, pred_input, default_on in spec:
        cams = _cams(g, _STAGE_PATH[sid])
        if not cams:            # absent group (None) or no renderable camera ([])
            continue
        out.append({
            "id": sid,
            "label": label,
            "note": note,
            "group": _STAGE_PATH[sid],
            "pred_input": pred_input,
            "default_on": default_on,
            "cameras": cams,
        })
    return out


def _camera_rows(stages: list[dict]) -> list[dict]:
    """One grid row per camera. Pair by name where the names match, by index otherwise."""
    if not stages:
        return []
    anchor_stage = next((s for s in stages if s["id"] == "model_input"), stages[0])
    anchor = [c["name"] for c in anchor_stage["cameras"]]
    row_count = max(len(s["cameras"]) for s in stages)
    rows = []
    for i in range(row_count):
        row = {}
        for s in stages:
            names = [c["name"] for c in s["cameras"]]
            if i < len(anchor) and anchor[i] in names:
                row[s["id"]] = anchor[i]
            elif i < len(names):
                row[s["id"]] = names[i]
            # else: key absent -> the UI renders a placeholder cell
        rows.append(row)
    return rows


def _pred_note(stages: list[dict], aug: bool | None) -> str | None:
    """Which image column pred_actions actually came from. None when it cannot be confused."""
    if len(stages) < 2:
        return None
    p = next((s for s in stages if s["pred_input"]), None)
    if p is None:
        return None
    note = f"pred_actions was sampled from the \u201c{p['label']}\u201d column"
    if p["id"] == "original":
        # sample_actions ran on the unaugmented images, but on the SERVED (corrupted) prompt.
        note += " (unaugmented images) together with the SERVED model_input prompt"
    if aug is False:
        note += " — augmentation is off, so both columns are the same picture"
    return note


def _image_note(kind: str, gen: str, aug: bool | None, b=None,
                off_tag: str = "aug_image=False") -> str:
    """The caption under the image grid. The UI renders it verbatim."""
    if kind in ("batch", "val_batch"):
        which = ("the held-out batch (prompt corruption off)" if kind == "val_batch"
                 else "the real training batch this process held")
        tail = (f" the image columns are byte-identical ({off_tag})."
                if aug is False else
                " model_input frames are POST-augmentation — what the vision encoder saw.")
        return (f"{which}, device 0 (B={b}) — inputs, ground truth and predictions." + tail)
    if gen == "G0":
        return ("old-format dump — model_input frames are pre-augmentation; post-augmentation frames "
                "were not recorded.")
    # G1 always dumped the augmented frames beside the pre-aug ones, so the
    # pred/post-aug warning always applies there; on G2 it applies iff preaug exists.
    if gen == "G1" or aug:
        return ("pred_actions was sampled from the pre-aug frames. The post-aug column is what the "
                "loss was computed on, not what pred came from.")
    return "aug_image=False — the model_input frames are both the pre- and the post-augmentation picture."


def _orig_prompt(g):
    """The uncorrupted prompt dataset of one view + which key it came from.

    The current writer emits original/prompt_text (the decoded ORACLE prompt, State:
    block included). The old split format emitted original/prompt (the bare dataset
    task string). Two different meanings, so the caller is told which one it got.
    """
    import h5py
    for key, tag in (("original/prompt_text", "original/prompt_text"),
                     ("original/prompt", "original/prompt")):
        ds = g.get(key)
        # A Group under that name has no [...] and would 500; probe, do not assume.
        if isinstance(ds, h5py.Dataset) and ds.ndim >= 1:
            return ds, tag
    return None, None


def _prompt_diffs(g):
    """-> (has_original_prompt, prompt_differs[], count|None, rate|None).

    count is None when the pair is absent: "not auditable", never "identical".
    """
    import h5py
    op, _ = _orig_prompt(g)
    mp = g.get("model_input/prompt_text")
    if op is None or not isinstance(mp, h5py.Dataset) or mp.ndim < 1:
        return False, [], None, None
    a = [_decode(x) for x in op[...]]
    b = [_decode(x) for x in mp[...]]
    differs = [a[i] != b[i] for i in range(min(len(a), len(b)))]
    count = int(sum(differs))
    return True, differs, count, (count / len(differs) if differs else None)


def _skill_classes(f) -> list[str] | None:
    """Root skill_classes, decoded. The writer emits it even with the head OFF, so a
    non-null value does NOT imply a skill/ group exists."""
    import h5py
    ds = f.get("skill_classes")
    if not isinstance(ds, h5py.Dataset) or ds.ndim != 1 or ds.shape[0] == 0:
        return None
    try:
        return [_decode(v) for v in ds[...]]
    except Exception:
        return None


def _skill_vocab(f, sg) -> tuple[int, list[str], str | None]:
    """(num_classes, class names, warning) for one skill/ group. Never hardcodes a K:
    the vocab has shipped with 4, 7, 8 and 9 classes."""
    import h5py
    logits, pred = sg.get("logits"), sg.get("pred")
    classes = _skill_classes(f)
    if isinstance(logits, h5py.Dataset) and logits.ndim == 2:
        k = int(logits.shape[1])
    elif classes:
        k = len(classes)
    elif isinstance(pred, h5py.Dataset) and pred.size:
        k = int(np.asarray(pred[...]).max()) + 1
    else:
        k = 0
    k = max(k, 0)
    if classes is None:
        return k, [f"class_{i}" for i in range(k)], \
            "skill_classes not recorded in this dump — classes shown by index"
    if len(classes) != k:
        padded = (list(classes) + [f"class_{i}" for i in range(len(classes), k)])[:k]
        return k, padded, f"skill_classes has {len(classes)} entries but logits has {k} columns"
    return k, list(classes), None


def _skill_rows(sg) -> int | None:
    """Row count of one skill/ group, from the only two datasets that define it."""
    import h5py
    for key, rank in (("pred", 1), ("logits", 2)):
        ds = sg.get(key)
        if isinstance(ds, h5py.Dataset) and ds.ndim == rank:
            return int(ds.shape[0])
    return None


def _skill_group(g):
    """The skill/ group of one view when it holds something renderable, else None."""
    import h5py
    sg = g.get("skill")
    if not isinstance(sg, h5py.Group):
        return None
    logits, pred = sg.get("logits"), sg.get("pred")
    if (isinstance(logits, h5py.Dataset) and logits.ndim == 2) or \
            (isinstance(pred, h5py.Dataset) and pred.ndim == 1):
        return sg
    return None


def _skill_stats(f, g) -> dict | None:
    """Batch-level skill-head stats, or None when this dump has no skill head."""
    import h5py
    sg = _skill_group(g)
    if sg is None:
        return None

    num_classes, classes, warn0 = _skill_vocab(f, sg)
    warn = [warn0] if warn0 else []

    logits, pred_ds = sg.get("logits"), sg.get("pred")
    if isinstance(pred_ds, h5py.Dataset) and pred_ds.ndim == 1:
        pred = np.asarray(pred_ds[...]).ravel().astype(np.int64)
    else:
        pred = np.asarray(logits[...], dtype=np.float64).argmax(axis=1).astype(np.int64)
    n = int(pred.shape[0])

    tgt_ds, ip_ds = sg.get("target"), sg.get("in_prompt")
    has_target = isinstance(tgt_ds, h5py.Dataset) and tgt_ds.ndim == 1
    has_in_prompt = isinstance(ip_ds, h5py.Dataset) and ip_ds.ndim == 1
    tgt = np.asarray(tgt_ds[...]).ravel().astype(np.int64) if has_target else np.zeros(0, np.int64)
    ip = np.asarray(ip_ds[...]).ravel().astype(bool) if has_in_prompt else np.zeros(0, bool)
    # A side dataset of a different length would silently shift the rows it is
    # compared against; drop it rather than mislabel every row after the gap.
    if has_target and tgt.shape[0] != n:
        has_target, tgt = False, np.zeros(0, np.int64)
    if has_in_prompt and ip.shape[0] != n:
        has_in_prompt, ip = False, np.zeros(0, bool)

    # UNLABELLED IS target < 0. The spec's -100 is wrong: transforms.py sets -1 and the
    # writer's own mask is tgt >= 0. Never test against a magic constant.
    labeled = (tgt >= 0) if has_target else np.zeros(n, bool)
    ok = (pred >= 0) & (pred < num_classes)
    if has_target:
        ok = ok & (~labeled | (tgt < num_classes))
    if n and not bool(ok.all()):
        warn.append(f"{int((~ok).sum())} row(s) carry a class index outside 0..{num_classes - 1}")

    lab = labeled & ok
    correct = (pred == tgt) if has_target else np.zeros(n, bool)

    def acc(mask):
        m = int(mask.sum())
        return (float(correct[mask].mean()) if m else None), m

    acc_pooled, n_pooled = acc(lab)
    ev = (lab & ~ip) if has_in_prompt else np.zeros(n, bool)
    inp = (lab & ip) if has_in_prompt else np.zeros(n, bool)
    acc_evidence, n_evidence = acc(ev)
    acc_in_prompt, n_in_prompt_labeled = acc(inp)

    target_counts = [int(((tgt == k) & lab).sum()) if has_target else 0 for k in range(num_classes)]
    pred_counts = [int(((pred == k) & ok).sum()) for k in range(num_classes)]

    subset = "evidence" if n_evidence > 0 else ("labeled" if n_pooled > 0 else None)
    confusion = None
    if subset is not None:
        mask = ev if subset == "evidence" else lab
        confusion = [[0] * num_classes for _ in range(num_classes)]
        for t, q in zip(tgt[mask].tolist(), pred[mask].tolist()):
            confusion[t][q] += 1

    if not has_target:
        note = "no skill targets in this dump — predictions only"
    elif n_pooled == 0:
        note = ("no frame in this group carries a skill label — every target is < 0, so no "
                "accuracy of any kind is reported")
    elif not has_in_prompt:
        note = ("in_prompt was not recorded in this dump, so this number includes frames whose "
                "prompt already contained the answer")
    elif n_evidence == 0:
        note = ("every labelled frame here had the skill clause in its served prompt — there is no "
                "evidence subset in this group, so no evidence accuracy is reported; the in-prompt "
                "number below measures copying, not perception")
    else:
        note = ("accuracy over frames whose served prompt did NOT contain the skill clause — the "
                "only frames where the head had to infer it")

    return {
        "num_classes": num_classes,
        "classes": classes,
        "classes_warning": "; ".join(warn) if warn else None,
        "n": n,
        "has_target": bool(has_target),
        "has_in_prompt": bool(has_in_prompt),
        # nan when nothing was supervised -> null, never NaN in JSON.
        "acc_file": _jf(sg.attrs["acc"]) if "acc" in sg.attrs else None,
        "n_supervised_file": _attr_int(sg, "n_supervised"),
        "n_labeled": n_pooled,
        "n_ignored": int((~labeled).sum()) if has_target else 0,
        "n_in_prompt": int(ip.sum()) if has_in_prompt else None,
        "acc_pooled": acc_pooled,
        "n_pooled": n_pooled,
        "acc_evidence": acc_evidence,
        "n_evidence": n_evidence,
        "acc_in_prompt": acc_in_prompt,
        "n_in_prompt_labeled": n_in_prompt_labeled,
        "confusion_subset": subset,
        "confusion": confusion,
        "class_counts": {"target": target_counts, "pred": pred_counts},
        "evidence_note": note,
    }


def _skill_sample(f, g, i: int) -> dict | None:
    """One row of the skill head: prediction, ground truth, and the distribution."""
    import h5py
    sg = _skill_group(g)
    if sg is None:
        return None
    num_classes, classes, _ = _skill_vocab(f, sg)
    # The same length gate _skill_stats applies (it drops a side dataset rather than
    # mislabel every row after the gap). Without it /info reports "no skill targets"
    # while this row shows a target chip, and target[i] may be another sample's.
    nrows = _skill_rows(sg)

    def row(key):
        ds = sg.get(key)
        if not isinstance(ds, h5py.Dataset) or ds.ndim < 1 or i >= ds.shape[0]:
            return None
        if key not in ("pred", "logits") and nrows is not None and ds.shape[0] != nrows:
            return None
        return ds[i]

    logits_row = row("logits")
    logits = np.asarray(logits_row, dtype=np.float64).ravel() if logits_row is not None else None
    probs = None
    if logits is not None and bool(np.all(np.isfinite(logits))):
        e = np.exp(logits - logits.max())
        probs = e / e.sum()

    p = row("pred")
    pred = int(np.asarray(p).ravel()[0]) if p is not None else (
        int(np.argmax(logits)) if logits is not None and logits.size else None)
    if pred is None:
        return None
    t = row("target")
    target = int(np.asarray(t).ravel()[0]) if t is not None else None
    labeled = target is not None and target >= 0

    def name_of(key, idx):
        v = row(key)
        if v is not None:
            return _decode(v)
        if idx is not None and 0 <= idx < len(classes):
            return classes[idx]
        return f"<ignore:{idx}>" if idx is not None else None

    ipv = row("in_prompt")
    pred_prob = (float(probs[pred]) if probs is not None and 0 <= pred < probs.shape[0] else None)
    target_prob = None
    true_rank = None
    if labeled and probs is not None and 0 <= target < probs.shape[0]:
        target_prob = float(probs[target])
        pt = probs[target]
        # Deterministic tie-break, so the rank is a total order with no ties.
        true_rank = 1 + int(sum(1 for j, pj in enumerate(probs.tolist())
                                if pj > pt or (pj == pt and j < target)))

    return {
        "pred": pred,
        "pred_name": name_of("pred_name", pred),
        "target": target,
        "target_name": name_of("target_name", target) if target is not None else None,
        "labeled": bool(labeled),
        "correct": bool(pred == target) if labeled else None,
        "in_prompt": bool(np.asarray(ipv).ravel()[0]) if ipv is not None else None,
        "logits": _jl(logits) if logits is not None else None,
        "probs": _jl(probs) if probs is not None else None,
        "classes": classes,
        "pred_prob": pred_prob,
        "target_prob": target_prob,
        "true_rank": true_rank,
    }


def _inherited_dim_real(f) -> int | None:
    """batch/ has no original/ stage, so its real dim can only come from a split.

    Kept as the value-only form; the routes go through _resolve_dim_real, which also
    reports WHICH split (or which other source) the number came from.
    """
    for s in _splits(f):
        d = _dim_real(f[s], None)
        if d is not None:
            return d
    return None


def _batch_info(f, gen: str, aug: bool | None, name: str = "batch",
                dim_names: dict | None = None) -> dict | None:
    """One device-sized batch group ("batch" or the held-out "val_batch").
    None when the writer did not emit it."""
    import h5py
    g = f.get(name)
    if not isinstance(g, h5py.Group):
        return None

    gt = g.get("gt_actions")
    gt_ok = isinstance(gt, h5py.Dataset) and gt.ndim == 3
    local = _attr_int(g, "local_batch_size")
    if local is None:
        local = int(gt.shape[0]) if isinstance(gt, h5py.Dataset) and gt.shape else 0

    dim_padded = int(gt.shape[2]) if gt_ok else None
    # No original/ in a batch-only dump, so the honest sources are, in order: a split,
    # the file's own dim names, and only then the built-in ti5 layout.
    dim_real, dim_real_from = _resolve_dim_real(f, g, dim_padded, dim_names, True)

    stages = _stages(g, "batch", gen, aug, _off_tag(f))
    has_orig_prompt, prompt_differs, diff_count, diff_rate = _prompt_diffs(g)
    return {
        "name": name,
        "device_batch_size": _attr_int(g, "device_batch_size"),
        "local_batch_size": local,
        "global_batch_size": _attr_int(g, "global_batch_size"),
        "process_index": _attr_int(g, "process_index"),
        "process_count": _attr_int(g, "process_count"),
        "device_count": _attr_int(g, "device_count"),
        "num_samples": _num_samples(g) or local,
        "horizon": int(gt.shape[1]) if gt_ok else None,
        "dim_padded": dim_padded,
        "dim_real": dim_real,
        "dim_real_from": dim_real_from,
        "has_output": _pred_dataset(g) is not None,
        "action_mse": _jf(g.attrs["action_mse"]) if "action_mse" in g.attrs else None,
        "has_tokenized_prompt": g.get("model_input/tokenized_prompt") is not None,
        "has_prompt_text": g.get("model_input/prompt_text") is not None,
        "has_model_state": g.get("model_input/state") is not None,
        "stages": stages,
        "camera_rows": _camera_rows(stages),
        "cameras": [
            {"stage": s["id"], "name": c["name"], "shape": c["shape"], "dtype": c["dtype"]}
            for s in stages for c in s["cameras"]
        ],
        "image_note": _image_note(name, gen, aug, _num_samples(g) or local, _off_tag(f)),
        "pred_note": _pred_note(stages, aug),
        "has_original_prompt": has_orig_prompt,
        "prompt_differs": prompt_differs,
        "prompt_diff_count": diff_count,
        "prompt_diff_rate": diff_rate,
        "skill": _skill_stats(f, g),
    }


def _asset_rel(asset_id) -> str | None:
    """config/norm_stats_asset_id -> a relative glob fragment, or None if it is unusable."""
    if not isinstance(asset_id, str):
        return None
    s = asset_id.strip()
    if not s or s.startswith("/") or Path(s).is_absolute():
        return None
    parts = s.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    return s


def _resolve_norm_stats(h5_path: Path, override: str | None, asset_id: str | None = None) -> dict:
    """-> {"found": bool, "path": str|None, "source": "query"|"asset"|"auto"|None,
           "dim": int|None, "error": str|None, "stats": dict|None}"""
    res = {"found": False, "path": None, "source": None, "dim": None, "error": None, "stats": None}

    p = None
    source = None
    if override:
        p = Path(override).expanduser().resolve()
        source = "query"
        if not p.is_file():
            res["error"] = f"norm_stats not found: {p}"
            return res
    elif h5_path.parent.name == "debug_dumps":
        exp = h5_path.parent.parent

        def _rank(c: Path):
            step_dir = c.relative_to(exp).parts[0]
            return (int(step_dir) if step_dir.isdigit() else -1, str(c))

        # config/norm_stats_asset_id names the exact asset dir the run trained with;
        # the wildcard glob below is the fallback for dumps that do not record it.
        cands = []
        rel = _asset_rel(asset_id)
        if rel:
            try:
                cands = list(exp.glob(f"*/assets/{rel}/norm_stats.json"))
            except OSError:
                cands = []
            if cands:
                source = "asset"
        if not cands:
            try:
                cands = list(exp.glob("*/assets/*/*/norm_stats.json")) + list(exp.glob("*/assets/*/norm_stats.json"))
            except OSError:
                cands = []
            if cands:
                source = "auto"
        if not cands and rel:
            # A step-0 dump predates the first checkpoint, so <exp>/*/assets/ does
            # not exist yet. Fall back to the training corpus the asset id names.
            for anc in exp.parents:
                if anc.name != "data":
                    continue
                for sub in ("datasets/lerobot", "datasets"):
                    c = anc / sub / rel / "norm_stats.json"
                    if c.is_file():
                        p, source = c, "corpus"
                        break
                if p is not None:
                    break
        if cands:
            p = max(cands, key=_rank)

    if p is None:
        res["error"] = "no norm_stats.json found beside the dump; showing normalized units only"
        return res

    try:
        size = p.stat().st_size
    except OSError as e:
        res["error"] = f"norm_stats not readable: {e}"
        return res
    if size > MAX_NORM_STATS_SIZE:
        res["error"] = f"norm_stats too large ({size} bytes): {p}"
        return res

    try:
        with open(p) as fh:
            obj = json.load(fh)
        ns = obj.get("norm_stats", obj)
        state, actions = ns["state"], ns["actions"]
        for d in (state, actions):
            if not isinstance(d["q01"], list) or not isinstance(d["q99"], list):
                raise ValueError("q01/q99 must be lists")
            if len(d["q01"]) != len(d["q99"]):
                raise ValueError("q01/q99 length mismatch")
    except Exception:
        res["error"] = f"malformed norm_stats: {p}"
        return res

    res.update({
        "found": True,
        "path": str(p),
        "source": source,
        "dim": len(actions["q01"]),
        "stats": {"state": state, "actions": actions},
    })
    return res


def _ns_public(ns: dict) -> dict:
    return {k: ns[k] for k in ("found", "path", "source", "dim", "error")}


def _denorm(norm: np.ndarray, st: dict, d: int):
    """norm[..., :d] -> raw units. Returns None if the stats or the array are too short."""
    q01 = np.asarray(st["q01"], dtype=np.float64)
    q99 = np.asarray(st["q99"], dtype=np.float64)
    if q01.shape[0] < d:
        return None
    a = np.asarray(norm, dtype=np.float64)
    # An array narrower than dim_real cannot be denormalized dim-by-dim. The
    # batch inherits dim_real from the splits, so nothing couples its width to
    # that number any more; report it as absent, not a 500. Same rule as
    # _permuted() below.
    if a.ndim < 1 or a.shape[-1] != d:
        return None
    q01, q99 = q01[:d], q99[:d]
    return (a + 1.0) / 2.0 * (q99 - q01 + 1e-6) + q01


def _num_samples(g) -> int:
    """N for a split, from the two (N,) datasets that are always cheap to stat."""
    for key in ("output/per_sample_mse", "per_sample_mse", "model_input/prompt_text",
                "gt_actions", "model_input/state"):
        ds = g.get(key)
        if ds is not None and getattr(ds, "shape", None):
            return int(ds.shape[0])
    return 0


def _dim_real(g, fallback):
    """Real (unpadded) action dim, from the raw arrays that are never padded."""
    ds = g.get("original/actions")
    if ds is not None and len(ds.shape) == 3:
        return int(ds.shape[2])
    ds = g.get("original/state")
    if ds is not None and len(ds.shape) == 2:
        return int(ds.shape[1])
    return fallback


def _gt_dataset(g):
    """output/gt_actions, model_input/actions (byte-identical), or batch/'s own gt_actions."""
    ds = g.get("output/gt_actions")
    if ds is None:
        ds = g.get("model_input/actions")
    if ds is None:
        ds = g.get("gt_actions")
    return ds


def _pred_dataset(g):
    """output/pred_actions, or batch/'s own pred_actions."""
    ds = g.get("output/pred_actions")
    return g.get("pred_actions") if ds is None else ds


def _mse_dataset(g):
    """output/per_sample_mse, or batch/'s own per_sample_mse."""
    ds = g.get("output/per_sample_mse")
    return g.get("per_sample_mse") if ds is None else ds


def _guard(path: str) -> Path:
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    if resolved.suffix.lower() not in (".h5", ".hdf5"):
        raise HTTPException(status_code=400, detail="Not an h5/hdf5 file")
    return resolved


def _split_info(f, name: str, gen: str | None = None, aug: bool | None = None,
                dim_names: dict | None = None) -> dict:
    import h5py

    g = f[name]
    if gen is None:
        gen = _generation(f)
    if aug is None:
        aug = _aug_image(f)
    n = _num_samples(g)

    indices = g.attrs.get("sample_indices")
    sample_indices = [int(x) for x in np.asarray(indices).ravel()] if indices is not None else []

    action_mse = g.attrs.get("action_mse")
    action_mse = _jf(action_mse) if action_mse is not None else None

    mse_ds = _mse_dataset(g)
    per_sample_mse = _jl(np.asarray(mse_ds[...]).ravel()) if mse_ds is not None else []

    has_orig_prompt, prompt_differs, diff_count, diff_rate = _prompt_diffs(g)

    gt = _gt_dataset(g)
    horizon = int(gt.shape[1]) if gt is not None and len(gt.shape) == 3 else None
    dim_padded = int(gt.shape[2]) if gt is not None and len(gt.shape) == 3 else None
    dim_real, dim_real_from = _resolve_dim_real(f, g, dim_padded, dim_names, False)

    cameras = []
    per_stage: dict[str, list[str]] = {}
    for stage in ("original", "model_input"):
        names = []
        grp = g.get(f"{stage}/images")
        if isinstance(grp, h5py.Group):
            for cam in sorted(grp.keys()):
                ds = grp.get(cam)
                if not isinstance(ds, h5py.Dataset) or ds.ndim not in (3, 4):
                    continue
                names.append(cam)
                cameras.append({
                    "stage": stage,
                    "name": cam,
                    "shape": [int(x) for x in ds.shape],
                    "dtype": str(ds.dtype),
                })
        per_stage[stage] = names

    camera_pairs = [
        {"original": o, "model_input": m}
        for o, m in zip(per_stage["original"], per_stage["model_input"])
    ]

    # The stage set of a split is decided by what is on disk, never by config/aug_image:
    # the writer only emits <split>/model_input/images_preaug when augmentation ran.
    has_preaug = bool(_cams(g, "model_input/images_preaug"))
    stages = _stages(g, "split", gen, aug)

    return {
        "name": name,
        "num_samples": n,
        "sample_indices": sample_indices,
        "action_mse": action_mse,
        "per_sample_mse": per_sample_mse,
        "prompt_differs": prompt_differs,
        "has_original_prompt": has_orig_prompt,
        "prompt_diff_count": diff_count,
        "prompt_diff_rate": diff_rate,
        "horizon": horizon,
        "dim_padded": dim_padded,
        "dim_real": dim_real,
        "dim_real_from": dim_real_from,
        "has_output": isinstance(g.get("output"), h5py.Group),
        "has_original_state": g.get("original/state") is not None,
        "has_original_actions": g.get("original/actions") is not None,
        "has_model_state": g.get("model_input/state") is not None,
        "has_tokenized_prompt": g.get("model_input/tokenized_prompt") is not None,
        "cameras": cameras,
        "camera_pairs": camera_pairs,
        "has_images_preaug": has_preaug,
        "stages": stages,
        "camera_rows": _camera_rows(stages),
        "image_note": _image_note("split", gen, has_preaug),
        "pred_note": _pred_note(stages, aug),
        "skill": _skill_stats(f, g),
    }


@router.get("/api/lm/info")
async def lm_info(path: str = Query(...), norm_stats: str | None = Query(None)):
    """Structure of an LM dump: splits, sample counts, cameras, prompt diffs."""
    resolved = _guard(path)
    try:
        with _open_lm(resolved) as f:
            step = f.attrs.get("step")
            config = f.attrs.get("config")
            gen = _generation(f)
            aug = _aug_image(f)
            kv = _config_kv(f)
            ns = _resolve_norm_stats(
                resolved, norm_stats, (kv or {}).get("norm_stats_asset_id")
            )
            ns_pub = _ns_public(ns)
            # The file's own slot order, read once and handed to every view.
            names = _file_dim_names(f)
            batch = _batch_info(f, gen, aug, "batch", names)
            val_batch = _batch_info(f, gen, aug, "val_batch", names)
            splits = [_split_info(f, s, gen, aug, names) for s in _splits(f)]
            views = [v for v in ([batch, val_batch] + splits) if v is not None]
            primary = views[0] if views else None
            layout = _dim_layout(names,
                                 primary["dim_real"] if primary else None,
                                 primary["dim_padded"] if primary else None,
                                 primary.get("dim_real_from") if primary else None)
            # Same check /api/lm/sample makes: stats shorter than the dump mean
            # every *_denorm field is null, so the badge must not read as ok.
            # Batch-only dumps have no splits, so scan every view or it can never fire.
            dims = [v["dim_real"] for v in views if v["dim_real"] is not None]
            if ns["dim"] is not None and dims and ns["dim"] < max(dims):
                ns_pub["error"] = f"norm_stats dim {ns['dim']} < dump dim {max(dims)}"
            result = {
                "path": str(resolved),
                "name": resolved.name,
                "step": int(step) if step is not None else 0,
                # The ROOT ATTR: the config NAME. Distinct from the config/ group below.
                "config": _decode(config) if config is not None else "",
                "generation": gen,
                "aug_image": aug,
                "config_kv": kv,
                "config_groups": _config_groups(kv),
                "dim_names": layout,
                "skill_classes": _skill_classes(f),
                "batch": batch,
                "val_batch": val_batch,
                "splits": splits,
                "norm_stats": ns_pub,
            }
            return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/api/lm/sample")
async def lm_sample(
    path: str = Query(...),
    split: str = Query("train"),
    sample: int = Query(0, ge=0),
    norm_stats: str | None = Query(None),
):
    """Everything needed to render one sample: prompts, actions, state, mse."""
    resolved = _guard(path)
    try:
        with _open_lm(resolved) as f:
            # Only real views: a plain "split in f" also matches config/, which has no samples.
            if split not in _view_names(f):
                raise HTTPException(status_code=404, detail=f"Split not found: {split}")
            g = f[split]
            is_batch = split in ("batch", "val_batch")
            n = _num_samples(g)
            if n == 0:
                raise HTTPException(status_code=404, detail=f"Split has no samples: {split}")
            i = min(sample, n - 1)

            gt_ds = _gt_dataset(g)
            horizon = int(gt_ds.shape[1]) if gt_ds is not None and len(gt_ds.shape) == 3 else None
            dim_padded = int(gt_ds.shape[2]) if gt_ds is not None and len(gt_ds.shape) == 3 else None
            if horizon is None:
                gt_ds = None  # rank != 3: nothing to slice; degrade to gt_norm: null
            # batch/ has no original/ stage, so its real dim comes from a split, from
            # the file's own dim names, or (last) from the built-in ti5 layout.
            names = _file_dim_names(f)
            dim_real, dim_real_from = _resolve_dim_real(f, g, dim_padded, names, is_batch)
            layout = _dim_layout(names, dim_real, dim_padded, dim_real_from)

            ns = _resolve_norm_stats(
                resolved, norm_stats, (_config_kv(f) or {}).get("norm_stats_asset_id")
            )
            stats = ns["stats"]
            ns_pub = _ns_public(ns)
            if stats is not None and dim_real is not None and ns["dim"] is not None and ns["dim"] < dim_real:
                ns_pub["error"] = f"norm_stats dim {ns['dim']} < dump dim {dim_real}"

            # DISPLAY ORDER IS FILE ORDER: sliced to dim_real as a trailing cut only,
            # so index k on screen is index k in the file.
            action_names, state_names = _sliced_dim_names(layout, dim_real)

            gt_row = _row(gt_ds, i)
            gt_norm = gt_row[:, :dim_real] if gt_row is not None else None
            pred_ds = _pred_dataset(g)
            if pred_ds is not None and len(pred_ds.shape) != 3:
                pred_ds = None
            # pred_actions[..., dim_real:] is model garbage on dead dims (max 0.74 measured).
            pred_row = _row(pred_ds, i)
            pred_norm = pred_row[:, :dim_real] if pred_row is not None else None

            act_ds = g.get("original/actions")
            act_row = _row(act_ds, i)
            actions_raw = np.asarray(act_row)[:, :dim_real] if act_row is not None else None

            gt_denorm = pred_denorm = None
            if stats is not None and dim_real is not None and gt_norm is not None:
                gt_denorm = _denorm(gt_norm, stats["actions"], dim_real)
            if stats is not None and dim_real is not None and pred_norm is not None:
                pred_denorm = _denorm(pred_norm, stats["actions"], dim_real)

            st_ds = g.get("model_input/state")
            st_row = _row(st_ds, i)
            state_norm = np.asarray(st_row)[:dim_real] if st_row is not None else None
            ost_ds = g.get("original/state")
            ost_row = _row(ost_ds, i)
            state_raw = np.asarray(ost_row)[:dim_real] if ost_row is not None else None
            state_denorm = None
            if stats is not None and dim_real is not None and state_norm is not None:
                state_denorm = _denorm(state_norm, stats["state"], dim_real)

            # state and action dim orders differ; permute state into action order for the
            # plot. BY NAME, never by index, and only to look up the t=0 marker value —
            # no displayed list is ever reordered.
            perm = None
            state_t0_reason = None
            if layout["source"] == "generic":
                state_t0_reason = ("no slot names in this dump — the t=0 state cannot be "
                                   "matched to action slots by name")
            elif state_norm is None and state_raw is None:
                state_t0_reason = "this view records no state"
            else:
                idx = {}
                for k, nm in enumerate(state_names):
                    idx.setdefault(nm, k)       # first occurrence wins on a duplicate
                missing = [nm for nm in action_names if nm not in idx]
                if missing:
                    state_t0_reason = (
                        f"{len(missing)} action slot(s) have no matching name in state_dim_names "
                        f"({', '.join(missing[:4])}{'…' if len(missing) > 4 else ''})")
                else:
                    perm = [idx[nm] for nm in action_names]
            aligned = perm is not None

            def _permuted(arr):
                nonlocal state_t0_reason
                if perm is None or arr is None:
                    return None
                a = np.asarray(arr, dtype=np.float64)
                # A state vector narrower than the action vector cannot be
                # permuted into action order; report it as absent, not a 500.
                if a.shape[0] != len(perm):
                    state_t0_reason = (f"state vector is {a.shape[0]} wide, "
                                       f"action order needs {len(perm)} names")
                    return None
                return _jl(a[perm])

            per_dim_mse = None
            mse_real_dims = None
            if gt_norm is not None and pred_norm is not None:
                sq = (np.asarray(pred_norm, dtype=np.float64) - np.asarray(gt_norm, dtype=np.float64)) ** 2
                per_dim = sq.mean(axis=0)
                per_dim_mse = _jl(per_dim)
                mse_real_dims = _jf(sq.mean())

            mse_ds = _mse_dataset(g)
            mse = _jf(np.asarray(mse_ds[i])) if mse_ds is not None else None

            indices = g.attrs.get("sample_indices")
            sample_index = None
            if indices is not None:
                flat = np.asarray(indices).ravel()
                if i < flat.shape[0]:
                    sample_index = int(flat[i])

            op, prompt_original_source = _orig_prompt(g)
            mp = g.get("model_input/prompt_text")
            # Either side can legitimately be shorter than the view (a partially
            # written pair); a short dataset is a missing prompt, not a 500.
            op_row, mp_row = _row(op, i), _row(mp, i)
            prompt_original = _decode(op_row) if op_row is not None else None
            prompt_model = _decode(mp_row) if mp_row is not None else None

            def _tok(key):
                import h5py
                ds = g.get(key)
                if not isinstance(ds, h5py.Dataset) or ds.ndim < 1 or i >= ds.shape[0]:
                    return None
                ids = np.asarray(ds[i]).ravel()
                return {
                    "length": int(ids.shape[0]),
                    "num_nonzero": int(np.count_nonzero(ids)),
                    "preview": [int(t) for t in ids[:32]],
                }

            tokenized_prompt = _tok("model_input/tokenized_prompt")
            tokenized_prompt_original = _tok("original/tokenized_prompt")

            state_t0 = {
                "aligned": bool(aligned),
                "raw": _permuted(state_raw),
                "norm": _permuted(state_norm),
                "denorm": _permuted(state_denorm),
            }
            state_t0["reason"] = state_t0_reason

            step = f.attrs.get("step")
            result = {
                "split": split,
                "source": "batch" if is_batch else "split",
                "sample": i,
                "num_samples": n,
                "sample_index": sample_index,
                "step": int(step) if step is not None else 0,

                "prompt_original": prompt_original,
                "prompt_original_source": prompt_original_source,
                "prompt_model": prompt_model,
                "prompt_differs": bool(
                    prompt_original is not None
                    and prompt_model is not None
                    and prompt_original != prompt_model
                ),
                "tokenized_prompt": tokenized_prompt,
                "tokenized_prompt_original": tokenized_prompt_original,

                "mse": mse,
                "mse_real_dims": mse_real_dims,
                "per_dim_mse": per_dim_mse,

                "horizon": horizon,
                "dim_real": dim_real,
                "dim_padded": dim_padded,
                "action_dim_names": action_names,
                "state_dim_names": state_names,
                "dim_names_source": layout["source"],
                "dim_names_warning": layout["warning"],
                "dim_real_from": dim_real_from,

                "gt_norm": _jl(gt_norm) if gt_norm is not None else None,
                "pred_norm": _jl(pred_norm) if pred_norm is not None else None,
                "gt_denorm": _jl(gt_denorm) if gt_denorm is not None else None,
                "pred_denorm": _jl(pred_denorm) if pred_denorm is not None else None,
                "actions_raw": _jl(actions_raw) if actions_raw is not None else None,

                "state_norm": _jl(state_norm) if state_norm is not None else None,
                "state_raw": _jl(state_raw) if state_raw is not None else None,
                "state_denorm": _jl(state_denorm) if state_denorm is not None else None,

                "state_t0": state_t0,

                "skill": _skill_sample(f, g, i),

                "norm_stats": ns_pub,
            }
            return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/api/lm/frame")
async def lm_frame(
    path: str = Query(...),
    split: str = Query("train"),
    sample: int = Query(0, ge=0),
    stage: str = Query("original"),
    camera: str = Query(...),
):
    """Render one camera frame of one sample as PNG."""
    import h5py

    resolved = _guard(path)
    if stage not in _STAGE_PATH:
        raise HTTPException(
            status_code=400,
            detail="stage must be one of original, model_input, model_input_preaug, model_input_aug",
        )
    try:
        with _open_lm(resolved) as f:
            if split not in _view_names(f):
                raise HTTPException(status_code=404, detail=f"Split not found: {split}")
            # Cost note: batch/model_input/images* is gzip-auto-chunked with the chunk
            # spanning the sample axis (16 frames at B=128, 64 at B=512), so one frame
            # request decompresses ~2.4 MB / ~9.6 MB. Acceptable: a sample view asks for
            # at most visible_stages x cameras (<= 6) frames and the browser caches them
            # for 300 s. Do not add a server cache or a chunk-aligned prefetch here.
            ds = f.get(f"{split}/{_STAGE_PATH[stage]}/{camera}")
            # An empty/odd camera resolves to the images Group, which has no .shape.
            if not isinstance(ds, h5py.Dataset):
                raise HTTPException(status_code=404, detail=f"Camera not found: {stage}/{camera}")
            # A zero-length (or scalar) dataset makes the clamp below index -1, and a
            # zero-sized H/W reaches Pillow as SystemError (not ValueError, so it would
            # escape the 400 handler). Degenerate structure is a 404, never a 500.
            if ds.ndim < 1 or 0 in ds.shape:
                raise HTTPException(status_code=404, detail=f"Camera not found: {stage}/{camera}")
            i = min(sample, ds.shape[0] - 1)
            arr = np.asarray(ds[i])
            if arr.ndim not in (2, 3) or (arr.ndim == 3 and arr.shape[2] not in (1, 3, 4)):
                raise HTTPException(status_code=400, detail="Cannot visualize frame shape")
            return Response(
                content=_array_to_png(arr),
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=300"},
            )
    except HTTPException:
        raise
    except ValueError as e:
        # _array_to_png rejects dtypes it cannot render; that is bad input.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
