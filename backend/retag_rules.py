"""Rule tags read from each run's config.json, re-runnable (drops and re-adds only these tags).

    all-box     bbox_overlay.others_always: every box drawn (target + others)   v16 / v17 / v18
    top3-box    bbox_overlay.only_largest == 3: target box, kept while it is among the 3 largest
    target-box  any other bbox_overlay: target box only (plain, or only_largest=True)
    aux-head    skill / progress / inverse / gripper head or aux_pool on
    1w-iter     starts from the official pi0.5 base weights and max_steps > 10000

    cd TianYan/backend && ../.venv/bin/python retag_rules.py
"""
import json

from api.exp_tags import apply_tags
from api.exps import rows_with_tags

RULE_TAGS = ("all-box", "top3-box", "target-box", "aux-head", "1w-iter")
HEADS = ("skill_head", "progress_head", "inverse_head", "gripper_head", "aux_pool")


def box_tag(box):
    if not box:
        return None
    box = box if isinstance(box, dict) else {}
    if box.get("others_always"):
        return "all-box"
    if box.get("only_largest") == 3:
        return "top3-box"
    return "target-box"


def rule_tags(row):
    try:
        cfg = json.loads(open(row["config_path"]).read())
    except (KeyError, OSError, ValueError):
        return []
    model = cfg.get("model", {}) or {}
    box = (cfg.get("train_dataloader", {}).get("dataset", {}) or {}).get("bbox_overlay")
    tags = [box_tag(box)]
    if any(model.get(h) for h in HEADS):
        tags.append("aux-head")
    if "official_pi05_base" in str(model.get("pretrained_model")) and (row.get("max_steps") or 0) > 10000:
        tags.append("1w-iter")
    return [t for t in tags if t]


def main():
    rows = rows_with_tags()
    apply_tags([r["exp"] for r in rows], remove=RULE_TAGS, by="claude")
    counts = {}
    for r in rows:
        tags = rule_tags(r)
        if tags:
            apply_tags([r["exp"]], add=tags, by="claude")
        for t in tags:
            counts.setdefault(t, []).append(r["exp"])
    for t in RULE_TAGS:
        print(f"{t:11s} {len(counts.get(t, [])):3d}  {', '.join(counts.get(t, []))}")


if __name__ == "__main__":
    main()
