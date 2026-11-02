"""Document text extraction."""

from io import BytesIO
from pathlib import Path
import logging
import zipfile

from docx import Document
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)

SCANNED_PDF_MESSAGE = "This looks like a scanned document. Text extraction is not supported yet."
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

def prepare_image(content: bytes, filename: str, max_bytes: int) -> bytes:
    """Anthropic Vision formats: https://platform.claude.com/docs/en/build-with-claude/vision
    Resize longest side to 1568 px and re-encode to remove EXIF/GPS metadata.
    """
    from PIL import Image, ImageOps
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix not in IMAGE_EXTENSIONS:
        raise ValueError(f"Unsupported image type: .{suffix or '<none>'}")
    signatures = {
        "jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
        "jpg": lambda data: data.startswith(b"\xff\xd8\xff"),
        "png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": lambda data: len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if not signatures[suffix](content):
        raise ValueError("The file is not a valid image")
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            image_format = image.format
            expected = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}[suffix]
            if image_format != expected:
                raise ValueError("Image contents do not match the file extension")
            image = ImageOps.exif_transpose(image).convert("RGB" if expected == "JPEG" else "RGBA" if expected == "PNG" else "RGB")
            image.thumbnail((1568, 1568), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format=expected, quality=88, optimize=True, exif=b"")
            clean = output.getvalue()
    except (OSError, SyntaxError, ValueError) as exc:
        raise ValueError("The file is not a valid image") from exc
    if len(clean) > max_bytes:
        raise ValueError(f"Image exceeds the {max_bytes // (1024 * 1024)} MB limit after processing")
    return clean


def verify_file_signature(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix in IMAGE_EXTENSIONS:
        prepare_image(content, filename, __import__("app.config", fromlist=["get_settings"]).get_settings().image_max_mb * 1024 * 1024)
        return suffix
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
