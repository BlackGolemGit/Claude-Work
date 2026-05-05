from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Paths
    DATA_DIR: Path = Path("data")
    DB_PATH: Path = Path("data/llm_server.db")
    UPLOAD_DIR: Path = Path("data/uploads")
    VECTORDB_DIR: Path = Path("data/vectordb")

    # Auth
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    DEFAULT_MODEL: str = "llama3.2:3b-instruct-q4_K_M"
    OLLAMA_TIMEOUT: int = 120

    # RAG
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    CHROMA_COLLECTION: str = "documents"
    RAG_TOP_K: int = 5
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64

    # Admin bootstrap
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "changeme"

    # Upload limits
    MAX_UPLOAD_BYTES: int = 50 * 1024 * 1024  # 50 MB

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
