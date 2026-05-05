from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.user import User
from backend.services.auth_service import is_token_valid


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    payload = is_token_valid(token, "access")
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    username = payload.get("sub")
    user = await db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_current_user_from_cookie(
    refresh_token: str = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    payload = is_token_valid(refresh_token, "refresh")
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    username = payload.get("sub")
    user = await db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user
