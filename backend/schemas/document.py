from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class DocumentOut(BaseModel):
    id: int
    original_name: str
    mime_type: str
    file_size: int
    status: str
    chunk_count: int
    created_at: datetime
    indexed_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class DocumentStatus(BaseModel):
    id: int
    status: str
    chunk_count: int
    error_msg: Optional[str]
