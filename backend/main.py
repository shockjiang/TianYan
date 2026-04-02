from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.directory import router as directory_router

app = FastAPI(title="TianYan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(directory_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
