"""Natural-language filter for the /exps page, answered by headless Claude Code.

    POST /api/exps/chat  {"message": str, "session_id": str | null}
      -> {"answer": str, "filters": {...}, "exps": [names], "session_id": str, "cost_usd": float}

Each call runs `claude -p` with READ-ONLY tools (Read / Grep / Glob + memory search MCP)
over: a snapshot of every run (runs.jsonl, written here), the manifold_model docs, and
all Claude Code conversations and memory (~/.claude/projects). `--json-schema` makes the
reply a filter object the page applies directly. Passing session_id back resumes the same
Claude session, so follow-ups ("only the bbox ones") keep context.
"""
import json
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.exp_tags import apply_tags
from api.exps import MM, rows_with_tags

router = APIRouter(prefix="/api/exps")

CLAUDE = os.environ.get("CLAUDE_BIN", "/root/.local/bin/claude")
CWD = Path(__file__).resolve().parent.parent / ".exps_chat"   # chat sessions are stored under this project
SNAPSHOT = CWD / "runs.jsonl"
TIMEOUT_S = 300
TOOLS = ",".join([
    "Read", "Grep", "Glob",
    "mcp__tdai-memory__tdai_conversation_search", "mcp__tdai-memory__tdai_memory_search",
    "mcp__graphiti-memory__search_memory_facts",
])
READ_DIRS = [str(MM), "/root/.claude/projects", "/manifoldai-infra-infra/shock"]
SNAPSHOT_KEYS = ("exp", "status", "version", "commit", "ts", "step", "max_steps", "loss", "action_loss",
                 "action_loss_mean5", "val_best", "val_newest", "probe", "ckpt", "gpus", "datasets",
                 "data_tags", "train_tags", "tags", "parent", "lr", "batch_per_device", "work_dir")

LIST = {"type": "array", "items": {"type": "string"}}
SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "short reply to the user, in Chinese"},
        "filters": {
            "type": "object",
            "properties": {"q": {"type": "string"}, "version": LIST, "datasets": LIST, "data_tags": LIST,
                           "train_tags": LIST, "tags": LIST, "status": LIST, "live": {"type": "boolean"}},
        },
        "exps": {**LIST, "description": "explicit experiment names; empty = use filters"},
        "tag_ops": {"type": "array", "description": "only when the user asks to tag / untag runs",
                    "items": {"type": "object", "properties": {"exps": LIST, "add": LIST, "remove": LIST},
                              "required": ["exps"]}},
    },
    "required": ["answer", "filters", "exps"],
}

SYSTEM = """You are the natural-language filter of an experiment board for the manifold_model repo
(pi05 VLA training runs). The user describes which experiments they want to see; you answer briefly
and return a filter the page applies.

Sources (read-only):
- {snapshot}: one JSON line per run with status, version, commit, step/max_steps, loss, action_loss,
  val MSE (val_best / val_newest, normalized matched_mse), probe MSE, datasets, data_tags,
  train_tags, parent (warm-start source). Grep or Read it; it is the ground truth for current numbers.
- {mm}/docs/ (exps.md, naming.md, datasets.md, criteria.md, train.md, eval.md): what each run,
  abbreviation, dataset and metric means.
- Claude Code conversations: /root/.claude/projects/<project>/*.jsonl (3 GB; Grep with a narrow
  pattern, the manifold_model ones are /root/.claude/projects/-manifoldai-infra-infra-shock-manifold-model*/),
  their memory: /root/.claude/projects/*/memory/*.md, and .remember/ folders under /manifoldai-infra-infra/shock/*.
  mcp__tdai-memory__tdai_conversation_search does semantic search over past conversations — use it for
  questions like "the run we discussed about shaking" or "why was v15 launched".

Filter semantics on the page: q = space-separated substrings of the name (all must match);
version / status = any of; datasets / data_tags / train_tags / tags = all of. "tags" are free-form
labels people (or you) attached to runs; they are in the snapshot's "tags" field. Use only these exact
values (facets with counts):
{facets}
When the request needs something the facets cannot express (numeric thresholds, "best 5 by val MSE",
runs mentioned in a conversation, a lineage), put the exact experiment names in "exps" instead and
leave filters empty. Otherwise leave "exps" empty. To clear everything return empty filters and exps.
If the user asks to tag or untag runs, fill "tag_ops" (exact experiment names, short tags,
same spelling as existing tags when the idea is the same) and also filter to those runs.
Keep "answer" to 1-3 sentences in Chinese; say which source you used when it was not the snapshot.
"""


class ChatIn(BaseModel):
    message: str
    session_id: str | None = None


def _write_snapshot():
    rows = rows_with_tags()
    CWD.mkdir(exist_ok=True)
    with open(SNAPSHOT, "w") as f:
        for r in rows:
            f.write(json.dumps({k: r.get(k) for k in SNAPSHOT_KEYS}, ensure_ascii=False, default=str) + "\n")
    facets = {}
    for key in ("version", "status", "datasets", "data_tags", "train_tags", "tags"):
        vals = {}
        for r in rows:
            for v in (r.get(key) if isinstance(r.get(key), list) else [r.get(key)]):
                if v not in (None, "-"):
                    vals[v] = vals.get(v, 0) + 1
        facets[key] = vals
    return facets


@router.post("/chat")
def chat(body: ChatIn):
    if not body.message.strip():
        raise HTTPException(400, "empty message")
    facets = _write_snapshot()
    cmd = [CLAUDE, "-p", body.message, "--output-format", "json", "--json-schema", json.dumps(SCHEMA),
           "--allowedTools", TOOLS, "--permission-mode", "dontAsk",
           "--append-system-prompt", SYSTEM.format(snapshot=SNAPSHOT, mm=MM,
                                                   facets=json.dumps(facets, ensure_ascii=False)),
           "--add-dir", *READ_DIRS]
    if body.session_id:
        cmd += ["--resume", body.session_id]
    try:
        p = subprocess.run(cmd, cwd=CWD, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"Claude did not answer within {TIMEOUT_S}s")
    try:
        out = json.loads(p.stdout)
    except ValueError:
        raise HTTPException(502, f"claude failed (exit {p.returncode}): {(p.stderr or p.stdout)[-800:]}")
    reply = out.get("structured_output")
    if out.get("is_error") or not isinstance(reply, dict):
        raise HTTPException(502, f"claude error: {str(out.get('result'))[:800]}")
    names = {r["exp"] for r in rows_with_tags()}
    for op in reply.get("tag_ops") or []:
        exps = [e for e in op.get("exps", []) if e in names]
        if exps:
            apply_tags(exps, op.get("add", []), op.get("remove", []), by="claude")
    return {**reply, "session_id": out.get("session_id"), "cost_usd": out.get("total_cost_usd"),
            "seconds": round((out.get("duration_ms") or 0) / 1000, 1)}
