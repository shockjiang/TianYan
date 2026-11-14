"""Side-by-side comparison for the /running sub-page.

The rows come from manifold_model's compare-exp skill (compare_exps.build, imported by path), so the page
and the standalone data/compare/*.html pages read the same recipe / loss fields. What the skill wants as a
hand-written spec is filled in here from the runs themselves:

- one column per (run, checkpoint): "last" = newest saved ckpt, "best" = ckpt with the lowest val MSE;
- the warm-start chain (config pretrained_model -> work_dirs/<run>/checkpoints/<step>) gives the curve
  offsets from the pi0.5 base and the samples seen by the ancestors;
- a hand-written spec in compare-exp/specs/ that names the same run wins for gpus / batch_schedule /
  live verdict / endpoint, and for the box-probe logs when it compared the same step;
- otherwise the robot verdict comes from tags (locating-good / real-good -> 好, *-bad -> 差) and the
  endpoint from an ep-<route> tag.

    POST /api/running/compare  {"cols": [{"exp": str, "ckpt": "last" | "best" | <int>}]}
"""
import importlib.util
import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.exps import MM, _state, rows_with_tags

router = APIRouter(prefix="/api/running")

SKILL = MM / ".claude/skills/compare-exp"
_spec = importlib.util.spec_from_file_location("compare_exps", SKILL / "compare_exps.py")
cx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cx)

GOOD, BAD = ("locating-good", "real-good"), ("locating-bad", "real-bad")
PROBE_ROWS = (  # (metric in the probe log, label, decimals) — same metrics as compare_exps, fewer rows
    ("mse_target@15", "★ 关节 action MSE @15（画目标框）", 5),
    ("eef_err_target_mm@15", "★ 末端误差 @15（画目标框）mm", 1),
    ("eef_err_target_mm@49", "末端误差 @49（画目标框）mm", 1),
    ("noise_floor_mm@49", "采样抖动 mm", 1),
    ("follow_gain_mm@49", "跟框增益 mm", 1),
    ("follow_rate", "跟框率", 2),
)


class Col(BaseModel):
    exp: str
    ckpt: str | int = "last"


class CompareIn(BaseModel):
    cols: list[Col]


def known_specs():
    """run -> (spec top level, experiment entry), newest spec file last so it wins."""
    out = {}
    for f in sorted((SKILL / "specs").glob("*.json"), key=lambda p: p.stat().st_mtime):
        try:
            spec = json.loads(f.read_text())
        except ValueError:
            continue
        for e in spec.get("experiments", []):
            out[e["run"]] = (spec, e)
    return out


def cfg_of(run):
    try:
        return cx.load_cfg(run)
    except SystemExit:  # run no longer on vePFS / ToS
        return {}


def ancestors(exp):
    """[(run, step), ...] from the pi0.5 base down to exp's direct parent, via config pretrained_model."""
    chain, seen = [], {exp}
    cur = exp
    while True:
        m = re.search(r"work_dirs/([^/]+)/checkpoints/(\d+)",
                      str(cfg_of(cur).get("model", {}).get("pretrained_model") or ""))
        if not m or m.group(1) in seen:
            return chain[::-1]
        seen.add(m.group(1))
        chain.append((m.group(1), int(m.group(2))))
        cur = m.group(1)


def global_batch(run, known):
    bs = cfg_of(run).get("train_dataloader", {}).get("per_device_batch_size")
    n = cx.gpus_of(run, known.get(run, (None, {}))[1].get("gpus"))
    return bs * n if bs and n else None


def resolve_step(row, ckpt):
    if ckpt == "best":
        return (row.get("val_best") or {}).get("step")
    if ckpt == "last":
        return row.get("ckpt") or row.get("step")
    return int(ckpt)


def verdict(row):
    tags = row.get("tags") or []
    if any(t in tags for t in GOOD):
        return "好"
    if any(t in tags for t in BAD):
        return "差"
    return None


def make_entry(row, ckpt, step, known):
    exp = row["exp"]
    short = row.get("recipe") or exp.split("-TS")[0]
    entry = {"id": re.sub(r"[^\w.-]", "_", f"{exp}@{step}"), "name": f"{short} @{step}", "run": exp, "step": step,
             "exp": exp, "ckpt": ckpt}
    spec, k = known.get(exp, (None, {}))
    for f in ("gpus", "batch_schedule"):
        if f in k:
            entry[f] = k[f]
    live = k.get("live") or verdict(row)
    if live:
        entry["live"] = live
    ep = k.get("endpoint") or next((f"/{t[3:]}/" for t in row.get("tags") or [] if t.startswith("ep-")), None)
    if ep:
        entry["endpoint"] = ep
    if spec and k.get("probe") and k.get("step") == step and spec.get("val_dir"):
        entry["probe"], entry["val_dir"] = k["probe"], spec["val_dir"]
    chain = ancestors(exp)
    entry["chain"] = chain
    entry["offset"] = sum(s for _, s in chain)
    entry["parent_samples"] = sum(s * (global_batch(r, known) or 0) for r, s in chain)
    return entry


def curves(entries):
    """Every logged loss per column on steps from the pi0.5 base: each ancestor up to the step it was forked at."""
    pts = []
    for e in entries:
        off = 0
        for run, until in e["chain"] + [(e["run"], e["step"])]:
            try:
                rows = cx.loss_rows(run)
            except SystemExit:  # ancestor no longer on vePFS / ToS
                rows = {}
            for st, r in sorted(rows.items()):
                if st > until:
                    break
                pts.append({"exp": e["id"], "step": st + off, "stage_step": st, "own": run == e["run"],
                            **{k: round(float(v), 8) for k, v in r.items() if cx.is_curve_key(k) and isinstance(v, (int, float))}})
            off += until
    return pts


@router.post("/compare")
def compare(body: CompareIn):
    if not body.cols:
        raise HTTPException(400, "no experiments selected")
    rows = {r["exp"]: r for r in rows_with_tags()}
    known = known_specs()
    entries, skipped = [], []
    for c in body.cols:
        row = rows.get(c.exp)
        step = resolve_step(row, c.ckpt) if row else None
        if not row or step is None:
            skipped.append({"exp": c.exp, "ckpt": c.ckpt, "why": ("没有 val 结果，无法确定最佳 ckpt" if c.ckpt == "best" else "还没有训练日志或 ckpt") if row else "实验不存在或已隐藏"})
            continue
        e = make_entry(row, c.ckpt, step, known)
        if e["id"] not in {x["id"] for x in entries}:  # best == last collapses to one column
            entries.append(e)
    if not entries:
        return {"cols": [], "rows": [], "curves": [], "bars": cx.DEFAULT_BARS, "skipped": skipped}
    ids = [e["id"] for e in entries]
    try:
        table, _ = cx.build({"experiments": entries, "loss_steps": [1000, 2000, 4000, 8000]})
    except SystemExit as err:
        raise HTTPException(404, str(err))
    vals = _state["val"].refresh()
    extra = []

    def add(group, key, metric, values, note=""):
        extra.append({"key": key, "group": group, "metric": metric, "note": note, **{i: str(values.get(i, "—")) for i in ids}})

    by_id = {e["id"]: e for e in entries}
    add("结果", "tags", "标签", {i: "、".join(rows[by_id[i]["exp"]].get("tags") or []) or "—" for i in ids})
    add("结果", "pick", "ckpt 选择", {i: {"best": "最佳（val 最低）", "last": "最新"}.get(str(by_id[i]["ckpt"]), str(by_id[i]["ckpt"])) for i in ids})
    add("训练配方", "chain", "初始化链（祖先 @分叉步）",
        {i: " → ".join(f"{r.split('-TS')[0]}@{s}" for r, s in by_id[i]["chain"]) or "官方 pi0.5 base" for i in ids})
    add("训练配方", "base_steps", "从 base 起累计步数", {i: str(by_id[i]["offset"] + by_id[i]["step"]) for i in ids})
    add("训练配方", "s_base_auto", "从 base 起累计样本数（自动）",
        {i: f'{(by_id[i]["parent_samples"] + by_id[i]["step"] * (global_batch(by_id[i]["run"], known) or 0)) / 1e6:.2f}M' for i in ids},
        "祖先：步数 × 全局 batch（GPU 数取自 run 名）")

    def val_at(i):
        v = vals.get((by_id[i]["exp"], by_id[i]["step"]))
        return f"{min(x[1] for x in v):.5f}" if v else "—"

    def val_best(i):
        b = rows[by_id[i]["exp"]].get("val_best")
        return f'{b["mse"]:.5f}' if b else "—"
    add("验证（if_probe）", "val_cmp", "val action MSE @比较的 ckpt", {i: val_at(i) for i in ids}, "matched_mse，各验证集取最小，归一化动作空间")
    add("验证（if_probe）", "val_best", "val action MSE 全程最优", {i: val_best(i) for i in ids})
    add("验证（if_probe）", "val_best_step", "最优所在 ckpt", {i: str((rows[by_id[i]["exp"]].get("val_best") or {}).get("step", "—")) for i in ids})
    for metric, label, nd in PROBE_ROWS:
        add("离线 box probe（SOP）", f"sop_{metric}", label,
            {i: cx.num(cx.probe(by_id[i].get("val_dir"), by_id[i].get("probe"), "sop", metric), nd) for i in ids},
            "仅当 compare-exp/specs 里有同一 run 同一 ckpt 的 probe 记录")
    # results first, then recipe ..., with the derived rows next to their group
    order = ["结果", "训练配方", "训练损失", "验证（if_probe）", "离线 box probe（SOP）"]
    all_rows = [r for r in table + extra if r["key"] not in ("s_base",)]  # s_base needs hand-written parents
    all_rows.sort(key=lambda r: order.index(r["group"]) if r["group"] in order else len(order))
    cols = [{"id": e["id"], "name": e["name"], "exp": e["exp"], "step": e["step"], "ckpt": e["ckpt"],
             "live": e.get("live"), "endpoint": e.get("endpoint")} for e in entries]
    bars = [b for b in cx.DEFAULT_BARS if b["key"] != "s_base"] + [
        {"key": "s_base_auto", "label": "从 base 起累计样本数（M）"},
        {"key": "val_cmp", "label": "val action MSE @比较的 ckpt", "better": "lower"},
        {"key": "sop_eef_err_target_mm@15", "label": "★ SOP 末端误差 @15 mm", "better": "lower"},
    ]
    return {"cols": cols, "rows": all_rows, "curves": curves(entries), "bars": bars, "skipped": skipped}
