from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import AsyncSessionLocal, get_db
from backend.dependencies import get_current_user, require_admin
from backend.models.document import Document
from backend.models.user import User
from backend.schemas.document import DocumentOut, DocumentStatus
from backend.services.document_processor import process_document
from backend.services.rag import delete_document as rag_delete, index_document

router = APIRouter()


async def _index_document_task(doc_id: int, path: Path, mime_type: str):
    async with AsyncSessionLocal() as db:
        doc = await db.get(Document, doc_id)
        if not doc:
            return
        doc.status = "processing"
        await db.commit()
        try:
            chunks = await process_document(path, mime_type, settings.CHUNK_SIZE, settings.CHUNK_OVERLAP)
            count = await index_document(doc_id, chunks)
            doc.status = "indexed"
            doc.chunk_count = count
            doc.indexed_at = datetime.now(timezone.utc)
        except Exception as e:
            doc.status = "error"
            doc.error_msg = str(e)[:512]
        await db.commit()


@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large (max {settings.MAX_UPLOAD_BYTES // 1024 // 1024} MB)")

    allowed_types = {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/tiff",
        "text/plain",
        "text/markdown",
        "text/csv",
    }
    mime = file.content_type or "application/octet-stream"
    if mime not in allowed_types:
        raise HTTPException(415, f"Unsupported file type: {mime}")

    safe_name = f"{uuid4().hex}_{Path(file.filename or 'upload').name}"
    dest = settings.UPLOAD_DIR / safe_name

    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    doc = Document(
        filename=safe_name,
        original_name=file.filename or "upload",
        mime_type=mime,
        file_size=len(content),
        uploaded_by=admin.id,
        status="pending",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    background_tasks.add_task(_index_document_task, doc.id, dest, mime)

    return {"id": doc.id, "status": "pending", "original_name": doc.original_name}


@router.get("/", response_model=list[DocumentOut])
async def list_documents(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.scalars(select(Document).order_by(Document.created_at.desc()))
    return [DocumentOut.model_validate(d) for d in result.all()]


@router.get("/{doc_id}/status", response_model=DocumentStatus)
async def document_status(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return DocumentStatus(id=doc.id, status=doc.status, chunk_count=doc.chunk_count, error_msg=doc.error_msg)


@router.delete("/{doc_id}", status_code=204)
async def delete_document_endpoint(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    file_path = settings.UPLOAD_DIR / doc.filename
    if file_path.exists():
        file_path.unlink()

    await rag_delete(doc_id)
    await db.delete(doc)
    await db.commit()
