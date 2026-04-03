import io
import pickle
import struct
import json
import numpy as np
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from api.directory import _safe_resolve

router = APIRouter()

MAX_PICKLE_SIZE = 100 * 1024 * 1024  # 100MB


class _StubObject:
    """Placeholder for objects whose class couldn't be imported."""
    def __init__(self, module, qualname):
        self.__stub_module__ = module
        self.__stub_qualname__ = qualname
    def __repr__(self):
        return f"<stub {self.__stub_module__}.{self.__stub_qualname__}>"
    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        else:
            self.__dict__['__state__'] = state


class ForgivingUnpickler(pickle.Unpickler):
    """Unpickler that replaces missing modules/classes with stub objects."""
    def __init__(self, f):
        super().__init__(f)
        self.warnings = []

    # Block dangerous modules from being loaded
    _BLOCKED_MODULES = {'os', 'subprocess', 'sys', 'builtins', 'shutil', 'signal', 'socket', 'ctypes', 'commands'}

    def find_class(self, module, name):
        top_module = module.split('.')[0]
        if top_module in self._BLOCKED_MODULES:
            self.warnings.append(f"Blocked dangerous import: {module}.{name}")
            def blocked_stub(*args, **kwargs):
                return _StubObject(module, name)
            return blocked_stub
        try:
            return super().find_class(module, name)
        except (ModuleNotFoundError, AttributeError, ImportError) as e:
            self.warnings.append(f"Missing {module}.{name}: {e}")
            def stub_factory(*args, **kwargs):
                obj = _StubObject(module, name)
                for i, a in enumerate(args):
                    obj.__dict__[f'arg_{i}'] = a
                obj.__dict__.update(kwargs)
                return obj
            stub_factory.__name__ = name
            stub_factory.__qualname__ = name
            return stub_factory


def _make_serializable(obj, depth=0, max_depth=10):
    """Convert arbitrary Python objects to JSON-serializable form."""
    if depth > max_depth:
        return f"<truncated at depth {max_depth}>"

    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj

    if isinstance(obj, bytes):
        if len(obj) <= 200:
            return f"<bytes len={len(obj)} hex={obj[:50].hex()}{'...' if len(obj) > 50 else ''}>"
        return f"<bytes len={len(obj)}>"

    if isinstance(obj, np.ndarray):
        info = {"__type__": "numpy.ndarray", "dtype": str(obj.dtype), "shape": list(obj.shape)}
        if obj.size <= 100:
            info["data"] = obj.tolist()
        else:
            info["data_preview"] = obj.flat[:20].tolist()
            info["min"] = float(np.nanmin(obj)) if obj.size > 0 else None
            info["max"] = float(np.nanmax(obj)) if obj.size > 0 else None
            info["mean"] = float(np.nanmean(obj)) if obj.size > 0 else None
        return info

    if isinstance(obj, np.generic):
        return obj.item()

    if isinstance(obj, dict):
        return {str(k): _make_serializable(v, depth + 1, max_depth) for k, v in obj.items()}

    if isinstance(obj, (list, tuple)):
        items = [_make_serializable(v, depth + 1, max_depth) for v in obj[:200]]
        if len(obj) > 200:
            items.append(f"<... {len(obj) - 200} more items>")
        return items

    if isinstance(obj, set):
        try:
            items = sorted(list(obj))[:200]
        except TypeError:
            items = list(obj)[:200]
        return _make_serializable(items, depth + 1, max_depth)

    # Handle stub objects from ForgivingUnpickler
    if isinstance(obj, _StubObject):
        result = {"__type__": f"{obj.__stub_module__}.{obj.__stub_qualname__} (stub)"}
        attrs = {k: v for k, v in obj.__dict__.items() if not k.startswith('__stub_')}
        result.update({k: _make_serializable(v, depth + 1, max_depth) for k, v in attrs.items()})
        return result

    # Fallback: try to serialize attributes
    try:
        attrs = {k: v for k, v in vars(obj).items() if not k.startswith('_')}
        result = {"__type__": type(obj).__module__ + "." + type(obj).__qualname__}
        result.update({k: _make_serializable(v, depth + 1, max_depth) for k, v in attrs.items()})
        return result
    except Exception:
        return f"<{type(obj).__name__}>"


@router.get("/api/pickle")
async def get_pickle(path: str = Query(..., description="Absolute path to .pkl file")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    suffix = resolved.suffix.lower()
    if suffix not in ('.pkl', '.pickle', '.pth', '.npy', '.npz'):
        raise HTTPException(status_code=400, detail="Not a pickle/numpy file")

    if resolved.stat().st_size > MAX_PICKLE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 100MB)")

    warnings = []

    try:
        if suffix in ('.npy',):
            data = np.load(str(resolved), allow_pickle=False)
        elif suffix in ('.npz',):
            npz = np.load(str(resolved), allow_pickle=False)
            data = {k: npz[k] for k in npz.files}
        else:
            raw = resolved.read_bytes()
            unpickler = ForgivingUnpickler(io.BytesIO(raw))
            data = unpickler.load()
            warnings = unpickler.warnings

        result = _make_serializable(data)
        return JSONResponse(content={
            "ok": True,
            "data": result,
            "source_type": suffix,
            "warnings": warnings if warnings else None,
        })
    except Exception as e:
        return JSONResponse(content={"ok": False, "error": str(e), "error_type": type(e).__name__})
