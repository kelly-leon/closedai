# ClosedAI

ClosedAI is an open-source personal AI agent that lets you ask questions against files you upload. It uses a retrieval-augmented generation (RAG) pipeline backed by a pgvector database, with pluggable authentication, storage, and embedding providers for both self-hosted and hosted deployments.

## Setup

Coming soon. The self-hosted Docker Compose environment will provision the Next.js frontend, FastAPI backend, and PostgreSQL with pgvector.

## Embedding configuration

`EMBEDDING_DIM` controls the pgvector column size and defaults to 384 for the local `sentence-transformers/all-MiniLM-L6-v2` model. Changing embedding providers or models can change vector dimensions and semantics; **all existing document chunks must be re-embedded and the pgvector column migrated before changing providers in production**.

## Project layout

- `frontend/` — Next.js App Router, TypeScript, and Tailwind CSS
- `backend/` — FastAPI application, provider abstractions, ingestion pipeline, and agent placeholders
- `docker-compose.yml` — local self-hosted services
