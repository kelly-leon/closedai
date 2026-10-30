"""Document text extraction."""

from io import BytesIO
from pathlib import Path
import logging
import zipfile

from docx import Document
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)

SCANNED_PDF_MESSAGE = "This looks like a scanned document. Text extraction is not supported yet."


def verify_file_signature(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix == "pdf":
        if not content.startswith(b"%PDF"):
            raise ValueError("The file is not a valid PDF")
        return suffix
    if suffix == "docx":
        if not content.startswith(b"PK"):
            raise ValueError("The file is not a valid DOCX archive")
        try:
            with zipfile.ZipFile(BytesIO(content)) as archive:
                names = set(archive.namelist())
                if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                    raise ValueError("The DOCX archive is missing expected Word entries")
                uncompressed = sum(info.file_size for info in archive.infolist())
                if uncompressed > 100_000_000 or len(content) and uncompressed / len(content) > 100:
                    raise ValueError("The DOCX archive exceeds safe extraction limits")
        except zipfile.BadZipFile as exc:
            raise ValueError("The file is not a valid DOCX archive") from exc
        return suffix
    if suffix in {"txt", "md"}:
        content.decode("utf-8-sig", errors="strict")
        return suffix
    raise ValueError(f"Unsupported file type: .{suffix or '<none>'}")


def parse_document(filename: str, content: bytes) -> list[tuple[int | None, str]]:
    """Extract page-aware text from a supported document."""
    suffix = Path(filename).suffix.lower().lstrip(".")
    verify_file_signature(filename, content)
    if suffix == "pdf":
        reader = PdfReader(BytesIO(content))
        settings = __import__("app.config", fromlist=["get_settings"]).get_settings()
        if len(reader.pages) > settings.max_pages:
            raise ValueError(f"PDF exceeds the {settings.max_pages}-page limit")
        pages = [(index, (page.extract_text() or "").strip()) for index, page in enumerate(reader.pages, start=1)]
        text = "\n".join(page_text for _, page_text in pages if page_text)
        if len(text) > settings.max_text_chars:
            raise ValueError(f"Document text exceeds the {settings.max_text_chars}-character limit")
        if len("".join(text.split())) < 50:
            raise ValueError(SCANNED_PDF_MESSAGE)
        return [(page, page_text) for page, page_text in pages if page_text]
    if suffix == "docx":
        document = Document(BytesIO(content))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()).strip()
        if not text:
            raise ValueError("DOCX contains no extractable text")
        settings = __import__("app.config", fromlist=["get_settings"]).get_settings()
        if len(text) > settings.max_text_chars:
            raise ValueError(f"Document text exceeds the {settings.max_text_chars}-character limit")
        return [(None, text)]
    if suffix in {"txt", "md"}:
        text = content.decode("utf-8-sig", errors="strict").strip()
        if not text:
            raise ValueError(f"{suffix.upper()} file is empty")
        return [(None, text)]
    raise ValueError(f"Unsupported file type: .{suffix or '<none>'}")
