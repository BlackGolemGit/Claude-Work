from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    email: EmailStr
    password: str = Field(min_length=8)
    role: Literal["user", "admin"] = "user"


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    role: Optional[Literal["user", "admin"]] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
