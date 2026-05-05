import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import AsyncSessionLocal, get_db
from backend.dependencies import get_current_user
from backend.models.chat import Conversation, Message
from backend.models.user import User
from backend.schemas.chat import (
    ChatSendRequest,
    ConversationCreate,
    ConversationOut,
    ConversationRename,
    MessageOut,
)
from backend.services.llm import chat_stream, list_models
from backend.services.rag import retrieve_context

router = APIRouter()

RAG_SYSTEM_PROMPT = (
    "You are a helpful assistant. Use the following context from uploaded documents "
    "to answer the user's question. If the context is not relevant, answer from your "
    "general knowledge.\n\n{context}\n\nAnswer helpfully based on this context where applicable."
)

MAX_HISTORY_MESSAGES = 20
MAX_HISTORY_WITH_RAG = 10


# ── Conversations ─────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.scalars(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
    )
    convos = result.all()
    out = []
    for c in convos:
        count = await db.scalar(
            select(func.count(Message.id)).where(Message.conversation_id == c.id)
        )
        item = ConversationOut.model_validate(c)
        item.message_count = count or 0
        out.append(item)
    return out


@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = Conversation(user_id=current_user.id, title=body.title, model=body.model)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    item = ConversationOut.model_validate(conv)
    item.message_count = 0
    return item


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
async def rename_conversation(
    conv_id: int,
    body: ConversationRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = await _get_owned_conversation(conv_id, current_user.id, db)
    conv.title = body.title
    await db.commit()
    await db.refresh(conv)
    item = ConversationOut.model_validate(conv)
    item.message_count = await db.scalar(
        select(func.count(Message.id)).where(Message.conversation_id == conv_id)
    ) or 0
    return item


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(
    conv_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = await _get_owned_conversation(conv_id, current_user.id, db)
    await db.delete(conv)
    await db.commit()


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conv_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_conversation(conv_id, current_user.id, db)
    result = await db.scalars(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.seq)
    )
    return [MessageOut.model_validate(m) for m in result.all()]


# ── Models ────────────────────────────────────────────────────────────────────

@router.get("/models")
async def get_models(_: User = Depends(get_current_user)):
    try:
        models = await list_models()
    except Exception:
        models = []
    return {"models": models}


# ── Streaming chat ────────────────────────────────────────────────────────────

@router.get("/stream")
async def stream_chat(
    conversation_id: int = Query(...),
    content: str = Query(..., max_length=32000),
    use_rag: bool = Query(default=True),
    model: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = await _get_owned_conversation(conversation_id, current_user.id, db)

    # Load recent history
    max_hist = MAX_HISTORY_WITH_RAG if use_rag else MAX_HISTORY_MESSAGES
    result = await db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.seq.desc())
        .limit(max_hist)
    )
    history = list(reversed(result.all()))

    next_seq = (history[-1].seq + 1) if history else 1

    # Persist user message immediately
    user_msg = Message(
        conversation_id=conversation_id,
        seq=next_seq,
        role="user",
        content=content,
        rag_used=False,
    )
    db.add(user_msg)
    await db.commit()

    # Build message list for Ollama
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": content})

    # RAG context injection
    rag_context = ""
    if use_rag:
        try:
            rag_context = await retrieve_context(content)
        except Exception:
            rag_context = ""
        if rag_context:
            messages.insert(0, {
                "role": "system",
                "content": RAG_SYSTEM_PROMPT.format(context=rag_context),
            })

    use_model = model or conv.model or None

    async def event_stream():
        accumulated: list[str] = []
        error_occurred = False
        try:
            async for delta in chat_stream(messages, model=use_model):
                accumulated.append(delta)
                yield f"data: {json.dumps({'delta': delta, 'done': False})}\n\n"
        except Exception as e:
            error_occurred = True
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

        if error_occurred:
            return

        full_response = "".join(accumulated)

        async with AsyncSessionLocal() as save_db:
            asst_msg = Message(
                conversation_id=conversation_id,
                seq=next_seq + 1,
                role="assistant",
                content=full_response,
                rag_used=bool(rag_context),
            )
            save_db.add(asst_msg)

            if conv.title == "New Chat" and content.strip():
                title_text = content.strip()[:60]
                title = title_text + ("..." if len(content.strip()) > 60 else "")
                c = await save_db.get(Conversation, conversation_id)
                if c:
                    c.title = title
                    c.updated_at = datetime.now(timezone.utc)

            await save_db.commit()
            await save_db.refresh(asst_msg)
            msg_id = asst_msg.id

        yield f"data: {json.dumps({'delta': '', 'done': True, 'message_id': msg_id})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Non-streaming send (for programmatic use) ─────────────────────────────────

@router.post("/send", response_model=MessageOut)
async def send_message(
    body: ChatSendRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = await _get_owned_conversation(body.conversation_id, current_user.id, db)

    result = await db.scalars(
        select(Message)
        .where(Message.conversation_id == body.conversation_id)
        .order_by(Message.seq.desc())
        .limit(MAX_HISTORY_MESSAGES)
    )
    history = list(reversed(result.all()))
    next_seq = (history[-1].seq + 1) if history else 1

    user_msg = Message(
        conversation_id=body.conversation_id,
        seq=next_seq,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.commit()

    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": body.content})

    rag_context = ""
    if body.use_rag:
        try:
            rag_context = await retrieve_context(body.content)
        except Exception:
            rag_context = ""
        if rag_context:
            messages.insert(0, {
                "role": "system",
                "content": RAG_SYSTEM_PROMPT.format(context=rag_context),
            })

    parts: list[str] = []
    async for delta in chat_stream(messages, model=body.model or conv.model or None):
        parts.append(delta)

    full_response = "".join(parts)
    asst_msg = Message(
        conversation_id=body.conversation_id,
        seq=next_seq + 1,
        role="assistant",
        content=full_response,
        rag_used=bool(rag_context),
    )
    db.add(asst_msg)
    await db.commit()
    await db.refresh(asst_msg)
    return MessageOut.model_validate(asst_msg)


# ── Helper ────────────────────────────────────────────────────────────────────

async def _get_owned_conversation(conv_id: int, user_id: int, db: AsyncSession) -> Conversation:
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == conv_id, Conversation.user_id == user_id
        )
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv
