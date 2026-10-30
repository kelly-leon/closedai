"""Check the configured embedding provider without exposing credentials."""

from app.config import get_settings
from app.embeddings.factory import get_embedding_provider


def main() -> None:
    settings = get_settings()
    provider = get_embedding_provider()
    vector = provider.embed_query("ClosedAI embedding configuration check")
    model = getattr(provider, "model", settings.local_embedding_model)
    print(f"provider={settings.embedding_provider}")
    print(f"model={model}")
    print(f"vector_length={len(vector)}")
    print(f"matches_embedding_dim={len(vector) == settings.embedding_dim}")


if __name__ == "__main__":
    main()
