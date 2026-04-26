import fcntl
import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from fastapi import APIRouter, HTTPException
from api.directory import _allowed_roots
from pydantic import BaseModel

router = APIRouter()

ALIAS_FILE = Path(__file__).parent.parent / "aliases.json"
SHARE_FILE = Path(__file__).parent.parent / "shares.json"


@contextmanager
def _locked_json(path: Path):
    """Context manager that yields (data, save) with an exclusive file lock.

    Usage::

        with _locked_json(ALIAS_FILE) as (data, save):
            data["key"] = "value"
            save(data)
    """
    path.touch(exist_ok=True)
    with open(path, "r+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            content = fh.read()
            data = json.loads(content) if content.strip() else {}
        except (json.JSONDecodeError, ValueError):
            data = {}

        def _save(new_data: dict) -> None:
            fh.seek(0)
            fh.truncate()
            fh.write(json.dumps(new_data, indent=2))

        yield data, _save
        # Lock released when the file handle closes


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

    with _locked_json(ALIAS_FILE) as (aliases, save):
        for alias_id, alias_path in aliases.items():
            if alias_path == path:
                return {"id": alias_id, "path": path}

        short_id = _make_short_id(path)
        while short_id in aliases and aliases[short_id] != path:
            short_id = short_id + "x"

        aliases[short_id] = path
        save(aliases)
        return {"id": short_id, "path": path}


@router.get("/api/alias/{alias_id}")
async def resolve_alias(alias_id: str):
    aliases = _load_json(ALIAS_FILE)
    path = aliases.get(alias_id)
    if not path:
        raise HTTPException(status_code=404, detail="Alias not found")
    _allowed_roots.add(path)
    return {"id": alias_id, "path": path}


# --- Full state share links ---

class SharedSide(BaseModel):
    root: str
    file: str | None = None
    viz: str | None = None


class ShareRequest(BaseModel):
    # Backward-compatible: clients can still POST {root, file, viz} for single side.
    root: str | None = None
    file: str | None = None
    viz: str | None = None
    # New shape: {a: SharedSide, b?: SharedSide}
    a: SharedSide | None = None
    b: SharedSide | None = None


def _normalize_request(req: ShareRequest) -> tuple[SharedSide, SharedSide | None]:
    if req.a is not None:
        return req.a, req.b
    if req.root is not None:
        return SharedSide(root=req.root, file=req.file, viz=req.viz), None
    raise HTTPException(status_code=400, detail="Share request requires either {a,b?} or {root,file?,viz?}")


def _side_to_state_str(side: SharedSide) -> str:
    root = side.root.rstrip("/")
    state = root
    if side.file:
        rel = side.file
        if rel.startswith(root + "/"):
            rel = rel[len(root) + 1:]
        state += "|" + rel
    if side.viz and side.viz != "single":
        state += "|" + side.viz
    return state


def _state_str_to_side(state: str) -> dict:
    parts = state.split("|")
    root = parts[0]
    rel_file = parts[1] if len(parts) > 1 else None
    viz = parts[2] if len(parts) > 2 else None
    file_path = (root + "/" + rel_file) if rel_file else None
    return {"root": root, "file": file_path, "viz": viz}


@router.post("/api/share")
async def create_share(req: ShareRequest):
    """Create a short share code for full state (one or two sides)."""
    a, b = _normalize_request(req)
    a_str = _side_to_state_str(a)
    canonical = a_str if b is None else f"{a_str}||{_side_to_state_str(b)}"

    with _locked_json(SHARE_FILE) as (shares, save):
        for code, stored in shares.items():
            stored_canonical = stored if isinstance(stored, str) else stored.get("__canonical__")
            if stored_canonical == canonical:
                return {"code": code}

        code = _make_short_id(canonical, length=5)
        while code in shares and (
            (isinstance(shares[code], str) and shares[code] != canonical) or
            (isinstance(shares[code], dict) and shares[code].get("__canonical__") != canonical)
        ):
            code = code + "x"

        shares[code] = {"__canonical__": canonical, "a": a_str, "b": _side_to_state_str(b) if b else None}
        save(shares)
        return {"code": code}


@router.get("/api/share/{code}")
async def resolve_share(code: str):
    """Resolve a share code to full state. Backward-compat for old string entries."""
    shares = _load_json(SHARE_FILE)
    stored = shares.get(code)
    if stored is None:
        raise HTTPException(status_code=404, detail="Share link not found")

    if isinstance(stored, str):
        # Legacy single-side entry
        a = _state_str_to_side(stored)
        _allowed_roots.add(a["root"])
        return {"a": a, "b": None, **a}

    a = _state_str_to_side(stored["a"])
    _allowed_roots.add(a["root"])
    b = None
    if stored.get("b"):
        b = _state_str_to_side(stored["b"])
        _allowed_roots.add(b["root"])
    return {"a": a, "b": b, **a}
