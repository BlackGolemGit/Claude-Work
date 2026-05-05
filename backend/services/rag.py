import asyncio

from backend.config import settings
from backend.services.embeddings import embed_texts

_client = None
_collection = None


def get_collection():
    global _client, _collection
    if _client is None:
        import chromadb
        _client = chromadb.PersistentClient(path=str(settings.VECTORDB_DIR))
        _collection = _client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


async def index_document(document_id: int, chunks: list[str]) -> int:
    col = get_collection()
    embeddings = await embed_texts(chunks)
    ids = [f"doc_{document_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [{"document_id": document_id, "chunk_index": i} for i in range(len(chunks))]

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: col.upsert(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas),
    )
    return len(chunks)


async def delete_document(document_id: int):
    col = get_collection()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, lambda: col.delete(where={"document_id": document_id})
    )


async def retrieve_context(query: str, top_k: int | None = None) -> str:
    col = get_collection()
    count = col.count()
    if count == 0:
        return ""

    k = min(top_k or settings.RAG_TOP_K, count)
    query_embedding = await embed_texts([query])

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None,
        lambda: col.query(
            query_embeddings=query_embedding,
            n_results=k,
            include=["documents", "distances"],
        ),
    )

    docs = results["documents"][0]
    distances = results["distances"][0]

    relevant = [(d, dist) for d, dist in zip(docs, distances) if dist < 0.6]
    if not relevant:
        return ""

    parts = [f"[Context {i + 1}]:\n{doc}" for i, (doc, _) in enumerate(relevant)]
    return "\n\n".join(parts)
