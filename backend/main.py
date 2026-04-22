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


@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Serve frontend static files
DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

@app.get("/{full_path:path}")
async def serve_frontend(request: Request, full_path: str):
    # Try to serve the exact file first (e.g., favicon.svg)
    file_path = DIST_DIR / full_path
    if full_path and file_path.resolve().is_relative_to(DIST_DIR.resolve()) and file_path.is_file():
        return FileResponse(str(file_path))
    # Fallback to index.html for SPA routing
    return FileResponse(str(DIST_DIR / "index.html"))
