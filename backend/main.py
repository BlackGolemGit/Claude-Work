import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.database import AsyncSessionLocal, init_db
from backend.models.user import User
from backend.routers import admin, auth, chat, documents
from backend.services.auth_service import hash_password
from backend.services.embeddings import preload_model
from sqlalchemy import select

_start_time = time.time()


async def _ensure_admin_user():
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(User).where(User.role == "admin"))
        if existing:
            return
        admin_user = User(
            username=settings.ADMIN_USERNAME,
            email=f"{settings.ADMIN_USERNAME}@localhost",
            hashed_pw=hash_password(settings.ADMIN_PASSWORD),
            role="admin",
        )
        db.add(admin_user)
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.DATA_DIR.mkdir(exist_ok=True)
    settings.UPLOAD_DIR.mkdir(exist_ok=True)
    settings.VECTORDB_DIR.mkdir(exist_ok=True)
    await init_db()
    await _ensure_admin_user()
    preload_model()
    yield


app = FastAPI(title="Offline LLM Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    )
    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "uptime_seconds": int(time.time() - _start_time)}


# Static files — API routes registered first, so they take priority
app.mount("/admin", StaticFiles(directory="frontend/admin", html=True), name="admin-ui")
app.mount("/", StaticFiles(directory="frontend/client", html=True), name="client-ui")
