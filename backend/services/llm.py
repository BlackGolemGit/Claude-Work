import json

import httpx

from backend.config import settings


async def chat_stream(messages: list[dict], model: str | None = None):
    """Async generator yielding text deltas from Ollama's streaming chat API."""
    url = f"{settings.OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": model or settings.DEFAULT_MODEL,
        "messages": messages,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=settings.OLLAMA_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                delta = chunk.get("message", {}).get("content", "")
                if delta:
                    yield delta
                if chunk.get("done"):
                    return


async def list_models() -> list[str]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
        resp.raise_for_status()
        return [m["name"] for m in resp.json().get("models", [])]


async def check_ollama_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False
