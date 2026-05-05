from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings

engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=settings.DEBUG,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from backend.models import user, chat, document  # noqa: F401 — registers ORM models

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
