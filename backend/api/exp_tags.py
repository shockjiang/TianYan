"""Free-form tags on experiments, added by the user or by Claude.

Store: backend/exp_tags.json = {exp: [{"tag": str, "by": "user" | "claude", "t": unix, "note": str?}]}
(file-locked like aliases.json). A tag is unique per exp; re-adding keeps the first author.

    POST /api/exps/tags          {"exps": [..], "add": [..], "remove": [..]}   by = user
    POST /api/exps/autotag       {"exps": [..] | null, "overwrite": false}     Claude proposes tags
"""
import json
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.alias import _locked_json

router = APIRouter(prefix="/api/exps")

TAGS_FILE = Path(__file__).resolve().parent.parent / "exp_tags.json"
AUTOTAG_TIMEOUT_S = 900


def load_tags() -> dict:
    try:
        return json.loads(TAGS_FILE.read_text()) if TAGS_FILE.exists() else {}
    except ValueError:
        return {}


def apply_tags(exps, add=(), remove=(), by="user", notes=None):
    """Add / remove tags on several exps in one locked write. Returns the new store."""
    add = [t.strip() for t in add if t and t.strip()]
    remove = set(t.strip() for t in remove if t)
    with _locked_json(TAGS_FILE) as (data, save):
        for exp in exps:
            cur = [e for e in data.get(exp, []) if e["tag"] not in remove]
            have = {e["tag"] for e in cur}
            for tag in add:
                if tag not in have:
                    entry = {"tag": tag, "by": by, "t": time.time()}
                    if notes and notes.get(exp):
                        entry["note"] = notes[exp]
                    cur.append(entry)
                    have.add(tag)
            if cur:
                data[exp] = cur
            else:
                data.pop(exp, None)
        save(data)
        return data


class TagsIn(BaseModel):
    exps: list[str]
    add: list[str] = []
    remove: list[str] = []


@router.post("/tags")
def edit_tags(body: TagsIn):
    if not body.exps:
        raise HTTPException(400, "no experiments given")
    data = apply_tags(body.exps, body.add, body.remove, by="user")
    return {e: data.get(e, []) for e in body.exps}


class AutoTagIn(BaseModel):
    exps: list[str] | None = None   # None = every run without a claude tag yet
    overwrite: bool = False         # drop existing claude tags on those runs first


AUTOTAG_SCHEMA = {
    "type": "object",
    "properties": {"runs": {"type": "array", "items": {
        "type": "object",
        "properties": {"exp": {"type": "string"},
                       "tags": {"type": "array", "items": {"type": "string"}},
                       "note": {"type": "string", "description": "one sentence why, in Chinese"}},
        "required": ["exp", "tags"]}}},
    "required": ["runs"],
}

AUTOTAG_PROMPT = """Assign 3-6 tags to each experiment listed below. People filter the board by typing #tag,
so every tag must be short, lowercase, without spaces (use - inside), and easy to type, e.g. #pi0.5 #ft.
Read {snapshot} (one JSON line per run), the manifold_model docs ({mm}/docs/exps.md, naming.md, datasets.md)
and, where useful, past Claude Code conversations (mcp__tdai-memory__tdai_conversation_search, or Grep in
/root/.claude/projects/-manifoldai-infra-infra-shock-manifold-model*/).

Cover, for every run:
- model family: pi0.5 (PI05), pi0.5-rtc, ... from model:* in train_tags
- how it started: scratch (from base weights), ft (fine-tuned / warm-started from another run), resume
- what it was for, in the repo's own vocabulary where one exists: smoke, baseline, ablation-<what>
  (e.g. ablation-bbox, ablation-recovery, ablation-shake-aug, ablation-fullft, ablation-frz-vis), if (skill-IF), bbox,
  recovery, sparse, teleop, rtc, enc, l8x ...
- what happened, only when a source says so: deployed (served on the robot), real-good / real-bad (real-robot result),
  diverged, superseded, launch-failed, not-a-run (directory without training).
Do NOT add status words (running, finished, stopped) — the board shows status itself.
Reuse one spelling for one idea across runs.
Existing user tags (keep the same spelling if you mean the same thing): {user_tags}
Only tag these experiments: {exps}
"""


@router.post("/autotag")
def autotag(body: AutoTagIn):
    from api.exps import MM, rows_with_tags
    from api.exps_chat import CLAUDE, CWD, READ_DIRS, SNAPSHOT, TOOLS, _write_snapshot

    _write_snapshot()
    store = load_tags()
    names = [r["exp"] for r in rows_with_tags()]
    todo = body.exps or (names if body.overwrite else
                         [e for e in names if not any(t["by"] == "claude" for t in store.get(e, []))])
    if not todo:
        return {"tagged": {}, "message": "every run already has Claude tags"}
    user_tags = sorted({t["tag"] for v in store.values() for t in v if t["by"] == "user"})
    prompt = AUTOTAG_PROMPT.format(snapshot=SNAPSHOT, mm=MM, user_tags=json.dumps(user_tags, ensure_ascii=False),
                                   exps=json.dumps(todo))
    cmd = [CLAUDE, "-p", prompt, "--output-format", "json", "--json-schema", json.dumps(AUTOTAG_SCHEMA),
           "--allowedTools", TOOLS, "--permission-mode", "dontAsk", "--add-dir", *READ_DIRS]
    try:
        p = subprocess.run(cmd, cwd=CWD, capture_output=True, text=True, timeout=AUTOTAG_TIMEOUT_S)
        out = json.loads(p.stdout)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"autotag did not finish within {AUTOTAG_TIMEOUT_S}s")
    except ValueError:
        raise HTTPException(502, f"claude failed (exit {p.returncode}): {(p.stderr or p.stdout)[-800:]}")
    runs = (out.get("structured_output") or {}).get("runs")
    if out.get("is_error") or not isinstance(runs, list):
        raise HTTPException(502, f"claude error: {str(out.get('result'))[:800]}")
    allowed = set(todo)
    tagged = {}
    for r in runs:
        if r.get("exp") not in allowed:
            continue
        if body.overwrite:
            old = [t["tag"] for t in load_tags().get(r["exp"], []) if t["by"] == "claude"]
            apply_tags([r["exp"]], remove=old, by="claude")
        apply_tags([r["exp"]], add=r.get("tags", []), by="claude", notes={r["exp"]: r.get("note", "")})
        tagged[r["exp"]] = r.get("tags", [])
    return {"tagged": tagged, "cost_usd": out.get("total_cost_usd"),
            "seconds": round((out.get("duration_ms") or 0) / 1000, 1)}
