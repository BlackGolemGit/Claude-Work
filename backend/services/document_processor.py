import asyncio
from pathlib import Path


def _extract_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages)


def _extract_image(path: Path) -> str:
    import pytesseract
    from PIL import Image
    img = Image.open(str(path))
    return pytesseract.image_to_string(img)


def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    words = text.split()
    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end]).strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


async def process_document(path: Path, mime_type: str, chunk_size: int, overlap: int) -> list[str]:
    loop = asyncio.get_event_loop()

    if mime_type == "application/pdf":
        text = await loop.run_in_executor(None, _extract_pdf, path)
    elif mime_type.startswith("image/"):
        text = await loop.run_in_executor(None, _extract_image, path)
    elif mime_type.startswith("text/"):
        text = path.read_text(errors="replace")
    else:
        raise ValueError(f"Unsupported mime type: {mime_type}")

    if not text.strip():
        raise ValueError("No text could be extracted from the document")

    return chunk_text(text, chunk_size, overlap)
