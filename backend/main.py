from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from api.directory import router as directory_router
from api.file import router as file_router
from api.file_info import router as file_info_router
from api.alias import router as alias_router
from api.pickle_api import router as pickle_router
from api.tabular import router as tabular_router
from api.npy import router as npy_router
from api.text_preview import router as text_preview_router
from api.usd import router as usd_router
from api.h5 import router as h5_router
from api.upload import router as upload_router
from api.rename import router as rename_router
from api.export_mp4 import router as export_mp4_router

app = FastAPI(title="TianYan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(directory_router)
app.include_router(file_router)
app.include_router(file_info_router)
app.include_router(alias_router)
app.include_router(pickle_router)
app.include_router(tabular_router)
app.include_router(npy_router)
app.include_router(text_preview_router)
app.include_router(usd_router)
app.include_router(h5_router)
app.include_router(upload_router)
app.include_router(rename_router)
app.include_router(export_mp4_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Serve frontend static files when a production build exists. In dev,
# vite serves the frontend on its own port (:15090) and proxies /api/* to
# us, so the dist folder is absent — the server must still start cleanly.
DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_HAS_DIST = (DIST_DIR / "index.html").is_file() and (DIST_DIR / "assets").is_dir()

if _HAS_DIST:
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(request: Request, full_path: str):
        # Try to serve the exact file first (e.g., favicon.svg).
        file_path = DIST_DIR / full_path
        if full_path and file_path.resolve().is_relative_to(DIST_DIR.resolve()) and file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback — never cache so asset hashes are always fresh.
        return FileResponse(
            str(DIST_DIR / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
else:
    @app.get("/")
    async def dev_root():
        return {
            "status": "ok",
            "note": "Frontend not built. Use the vite dev server on :15090, "
                    "or run `npx vite build` in frontend/ to enable serving "
                    "the SPA from this backend.",
        }
