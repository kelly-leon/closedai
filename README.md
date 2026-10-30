# ClosedAI

## Hosted billing configuration

Hosted token billing uses the following environment variables: `TOKENS_PER_MESSAGE`, `TRIAL_TOKENS_PER_WEEK`, `TRIAL_DOCUMENTS`, `PAID_DOCUMENTS`, `PREMIUM_DOCUMENTS`, `PREMIUM_DAILY_CAP`, `MPESA_TILL_NUMBER`, `ADMIN_EMAILS`, `ADMIN_NOTIFY_EMAIL`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TIMEZONE`, and `FRONTEND_URL`. Never put real credentials in this repository.

Each user receives a derived 100-token weekly trial allowance by default. Unused trial tokens expire after seven days and are never transferred to the purchased balance. Purchases, redeem codes, and admin grants alone add to `token_balance`.

Pre-existing local/selfhosted data belongs to the selfhosted default user and does not carry over to Supabase users.

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

Hosted document uploads also require the server-only `SUPABASE_SERVICE_KEY`, and use the private bucket configured by `SUPABASE_BUCKET` (for example, `documents`). Do not add the service-role key to any `NEXT_PUBLIC_*` frontend variable.

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

## Production hardening

Hosted deployments should provide explicit public HTTPS origins through `CORS_ORIGINS`; hosted startup rejects wildcards and localhost origins. `SENTRY_DSN` enables backend Sentry collection, while `NEXT_PUBLIC_SENTRY_DSN` enables frontend collection. Authorization headers and request bodies are scrubbed.

The API limiters use process-local memory by default. Their limits are per application instance; deploy a shared Redis-backed implementation of `RateLimitBackend` for horizontally scaled hosted deployments.

Upload limits default to 300 PDF pages and 2,000,000 extracted characters. `MAX_PAGES` and `MAX_TEXT_CHARS` can be adjusted with environment variables. API documentation can be enabled explicitly in hosted mode with `ENABLE_DOCS=true`.
