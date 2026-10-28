"""Document text extraction."""

from io import BytesIO
from pathlib import Path

from docx import Document
from pypdf import PdfReader


def parse_document(filename: str, content: bytes) -> list[tuple[int | None, str]]:
    """Extract page-aware text from a supported document."""
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix == "pdf":
        pages = [(index, (page.extract_text() or "").strip()) for index, page in enumerate(PdfReader(BytesIO(content)).pages, start=1)]
        text = "\n".join(page_text for _, page_text in pages if page_text)
        if not text.strip():
            raise ValueError("PDF contains no extractable text; scanned PDFs are not supported")
        return [(page, page_text) for page, page_text in pages if page_text]
    if suffix == "docx":
        document = Document(BytesIO(content))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()).strip()
        if not text:
            raise ValueError("DOCX contains no extractable text")
        return [(None, text)]
    if suffix in {"txt", "md"}:
        text = content.decode("utf-8-sig", errors="strict").strip()
        if not text:
            raise ValueError(f"{suffix.upper()} file is empty")
        return [(None, text)]
    raise ValueError(f"Unsupported file type: .{suffix or '<none>'}")
