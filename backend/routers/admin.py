import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.dependencies import require_admin
from backend.models.chat import Conversation, Message
from backend.models.document import Document
from backend.models.user import User
from backend.schemas.user import UserCreate, UserOut, UserUpdate
from backend.services.auth_service import hash_password
from backend.services.llm import check_ollama_health

router = APIRouter()

_server_start = time.time()


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.scalars(select(User).order_by(User.created_at))
    return [UserOut.model_validate(u) for u in result.all()]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = await db.scalar(
        select(User).where((User.username == body.username) | (User.email == body.email))
    )
    if existing:
        raise HTTPException(400, "Username or email already in use")

    user = User(
        username=body.username,
        email=body.email,
        hashed_pw=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return UserOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    if body.email is not None:
        conflict = await db.scalar(
            select(User).where(User.email == body.email, User.id != user_id)
        )
        if conflict:
            raise HTTPException(400, "Email already in use")
        user.email = body.email

    if body.role is not None:
        if user.id == admin.id and body.role != "admin":
            raise HTTPException(400, "Cannot demote yourself")
        user.role = body.role

    if body.is_active is not None:
        if user.id == admin.id and not body.is_active:
            raise HTTPException(400, "Cannot deactivate yourself")
        user.is_active = body.is_active

    if body.password is not None:
        user.hashed_pw = hash_password(body.password)

    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if user_id == admin.id:
        raise HTTPException(400, "Cannot delete yourself")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = False
    await db.commit()


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    total_users = await db.scalar(select(func.count(User.id)))
    active_users = await db.scalar(select(func.count(User.id)).where(User.is_active == True))  # noqa: E712
    admin_users = await db.scalar(select(func.count(User.id)).where(User.role == "admin"))
    total_convos = await db.scalar(select(func.count(Conversation.id)))
    total_messages = await db.scalar(select(func.count(Message.id)))
    total_docs = await db.scalar(select(func.count(Document.id)))
    indexed_docs = await db.scalar(
        select(func.count(Document.id)).where(Document.status == "indexed")
    )
    error_docs = await db.scalar(
        select(func.count(Document.id)).where(Document.status == "error")
    )
    total_size = await db.scalar(select(func.sum(Document.file_size))) or 0

    try:
        from backend.services.rag import get_collection
        chroma_chunks = get_collection().count()
    except Exception:
        chroma_chunks = 0

    ollama_ok = await check_ollama_health()

    return {
        "users": {"total": total_users, "active": active_users, "admins": admin_users},
        "conversations": {"total": total_convos},
        "messages": {"total": total_messages},
        "documents": {
            "total": total_docs,
            "indexed": indexed_docs,
            "error": error_docs,
            "total_size_bytes": total_size,
        },
        "system": {
            "ollama_status": "online" if ollama_ok else "offline",
            "chroma_chunks": chroma_chunks,
            "uptime_seconds": int(time.time() - _server_start),
        },
    }


@router.post("/documents/reindex/{doc_id}", status_code=202)
async def reindex_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    from pathlib import Path

    from fastapi import BackgroundTasks

    from backend.config import settings
    from backend.routers.documents import _index_document_task

    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    doc.status = "pending"
    doc.error_msg = None
    await db.commit()

    path = settings.UPLOAD_DIR / doc.filename
    import asyncio

    asyncio.create_task(_index_document_task(doc_id, path, doc.mime_type))
    return {"id": doc_id, "status": "pending"}
