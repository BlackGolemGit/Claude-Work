from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    title: str = "New Chat"
    model: str = ""


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=256)


class ConversationOut(BaseModel):
    id: int
    title: str
    model: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class MessageOut(BaseModel):
    id: int
    seq: int
    role: str
    content: str
    rag_used: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSendRequest(BaseModel):
    conversation_id: int
    content: str = Field(max_length=32000)
    use_rag: bool = True
    model: Optional[str] = None
