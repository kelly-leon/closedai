"""Page-aware text chunking."""

import re


def chunk_text(text: str, size: int = 800, overlap: int = 150) -> list[str]:
    """Split text near paragraph or sentence boundaries."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = max(text.rfind("\n\n", start, end), text.rfind(". ", start, end), text.rfind("? ", start, end), text.rfind("! ", start, end))
            if boundary > start:
                end = boundary + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end - overlap > start else end
    return chunks


def chunk_pages(pages: list[tuple[int | None, str]], size: int = 800, overlap: int = 150) -> list[tuple[int | None, str]]:
    """Chunk each page while retaining its page number."""
    return [(page, chunk) for page, text in pages for chunk in chunk_text(text, size, overlap)]
