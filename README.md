# ClosedAI

ClosedAI is an open-source personal AI agent that lets you ask questions against files you upload. It uses a retrieval-augmented generation (RAG) pipeline backed by a pgvector database, with pluggable authentication, storage, and embedding providers for both self-hosted and hosted deployments.

## Setup

The self-hosted Docker Compose environment provisions the Next.js frontend, FastAPI backend, and PostgreSQL with pgvector.

### Frontend development

```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `.env` to point the frontend at the backend. Docker Compose passes the same variable to the frontend service.

For hosted Supabase authentication, set `MODE=hosted`, `AUTH_PROVIDER=supabase`, `SUPABASE_URL=https://your-project.supabase.co`, and the optional asymmetric/shared JWT settings. In the frontend, set `NEXT_PUBLIC_AUTH_MODE=supabase` and provide `NEXT_PUBLIC_SUPABASE_URL` and the public `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never configure the Supabase service-role key in the frontend. Google sign-in is optional through `NEXT_PUBLIC_GOOGLE_AUTH=true`.

Pre-existing selfhosted documents and chats belong to the fixed selfhosted default user and are not migrated or shared with Supabase users. Each Supabase user starts with their own private data.

## Embedding configuration

`EMBEDDING_DIM` controls the pgvector column size and defaults to 384 for the local `sentence-transformers/all-MiniLM-L6-v2` model. Changing embedding providers or models can change vector dimensions and semantics; **all existing document chunks must be re-embedded and the pgvector column migrated before changing providers in production**.

## Project layout

- `frontend/` — Next.js App Router, TypeScript, and Tailwind CSS
- `backend/` — FastAPI application, provider abstractions, ingestion pipeline, and agent placeholders
- `docker-compose.yml` — local self-hosted services

## Units, usage, and redeem codes

Files and chats are organized into units. In hosted mode, trial limits are configured with `TRIAL_MESSAGES` and `TRIAL_DOCUMENTS`. Administrators can create paid redeem codes with:

```bash
curl -X POST http://localhost:8000/admin/codes \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"count":1,"message_quota":1000,"document_quota":100,"duration_days":30}'
```

Plain codes are returned only once by this endpoint. The CLI creates codes in the same database:

```bash
cd backend
.venv/Scripts/python.exe scripts/make_codes.py --count 1 --message-quota 1000 --document-quota 100 --duration-days 30
```

Only SHA-256 hashes of codes are stored. Never commit `.env` or generated plain codes.
