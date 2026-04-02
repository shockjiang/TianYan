import hashlib
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ALIAS_FILE = Path(__file__).parent.parent / "aliases.json"
SHARE_FILE = Path(__file__).parent.parent / "shares.json"


def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return {}
    return {}


def _save_json(path: Path, data: dict):
    path.write_text(json.dumps(data, indent=2))


def _make_short_id(content: str, length: int = 5) -> str:
    """Generate a short base36 ID from content."""
    h = hashlib.md5(content.encode()).hexdigest()
    num = int(h[:10], 16)
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = []
    while num:
        result.append(chars[num % 36])
        num //= 36
    return "".join(reversed(result or ["0"]))[:length]


# --- Root path aliases (kept for backward compat) ---

class AliasRequest(BaseModel):
    path: str


@router.post("/api/alias")
async def create_alias(req: AliasRequest):
    path = req.path.rstrip("/")
    if not Path(path).is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    aliases = _load_json(ALIAS_FILE)
    for alias_id, alias_path in aliases.items():
        if alias_path == path:
            return {"id": alias_id, "path": path}

    short_id = _make_short_id(path)
    while short_id in aliases and aliases[short_id] != path:
        short_id = short_id + "x"

    aliases[short_id] = path
    _save_json(ALIAS_FILE, aliases)
    return {"id": short_id, "path": path}


@router.get("/api/alias/{alias_id}")
async def resolve_alias(alias_id: str):
    aliases = _load_json(ALIAS_FILE)
    path = aliases.get(alias_id)
    if not path:
        raise HTTPException(status_code=404, detail="Alias not found")
    return {"id": alias_id, "path": path}


# --- Full state share links ---

class ShareRequest(BaseModel):
    root: str
    file: str | None = None
    viz: str | None = None


@router.post("/api/share")
async def create_share(req: ShareRequest):
    """Create a short share code for the full state (root + file + viz)."""
    root = req.root.rstrip("/")
    # Build a canonical state string for deduplication
    state = root
    if req.file:
        # Store file as relative to root
        rel = req.file
        if rel.startswith(root + "/"):
            rel = rel[len(root) + 1:]
        state += "|" + rel
    if req.viz and req.viz != "single":
        state += "|" + req.viz

    shares = _load_json(SHARE_FILE)

    # Check if this exact state already has a code
    for code, stored_state in shares.items():
        if stored_state == state:
            return {"code": code}

    code = _make_short_id(state, length=5)
    while code in shares and shares[code] != state:
        code = code + "x"

    shares[code] = state
    _save_json(SHARE_FILE, shares)
    return {"code": code}


@router.get("/api/share/{code}")
async def resolve_share(code: str):
    """Resolve a share code to full state."""
    shares = _load_json(SHARE_FILE)
    state = shares.get(code)
    if not state:
        raise HTTPException(status_code=404, detail="Share link not found")

    parts = state.split("|")
    root = parts[0]
    rel_file = parts[1] if len(parts) > 1 else None
    viz = parts[2] if len(parts) > 2 else None

    file_path = None
    if rel_file:
        file_path = root + "/" + rel_file

    return {"root": root, "file": file_path, "viz": viz}
