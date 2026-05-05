import asyncio

from backend.config import settings

_model = None


def preload_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(settings.EMBEDDING_MODEL)
    return _model


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts in a thread executor to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    model = preload_model()
    embeddings = await loop.run_in_executor(
        None, lambda: model.encode(texts, show_progress_bar=False).tolist()
    )
    return embeddings
