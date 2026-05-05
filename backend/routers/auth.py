from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.dependencies import get_current_user, get_current_user_from_cookie
from backend.models.user import User
from backend.schemas.user import LoginRequest, TokenResponse, UserOut
from backend.services.auth_service import (
    create_access_token,
    create_refresh_token,
    verify_password,
)

router = APIRouter()

REFRESH_COOKIE = "refresh_token"
COOKIE_MAX_AGE = 7 * 24 * 3600  # 7 days in seconds


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.username == body.username))
    if not user or not user.is_active or not verify_password(body.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(user.username, user.role)
    refresh_token = create_refresh_token(user.username)

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
    )

    return TokenResponse(access_token=access_token, user=UserOut.model_validate(user))


@router.post("/refresh")
async def refresh(response: Response, user: User = Depends(get_current_user_from_cookie)):
    access_token = create_access_token(user.username, user.role)
    refresh_token = create_refresh_token(user.username)

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(REFRESH_COOKIE)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)
