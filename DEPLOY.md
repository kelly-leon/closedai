# Deploying ClosedAI

## Supabase

1. Create a Supabase project and enable the `vector` extension.
2. Create a private Storage bucket named `documents`.
3. Configure Supabase Auth providers and add the final Vercel origin to the allowed redirect origins.
4. Copy the project URL and keys from **Project Settings > API**.
5. Copy the session and transaction pooler connection URLs from **Database > Connect**.

Database URLs have different purposes:

- **Alembic and migrations:** use the Supabase **session pooler** URL, with SSL required.
- **Render application:** use the Supabase **transaction pooler** URL in `DATABASE_URL`, with SSL required. For SQLAlchemy/psycopg, transaction pooling disables prepared statements automatically in this app (`prepare_threshold=0`).
- Direct IPv6 database access can also be used only when Render networking supports it.
- Example URL shape: `postgresql://postgres.PROJECT_REF:[PASSWORD]@REGION.pooler.supabase.com:6543/postgres?sslmode=require`. The session pooler normally uses port `5432`; the transaction pooler uses port `6543`.

Never put the service-role key in a `NEXT_PUBLIC_*` variable.

## Database migrations

From `C:\Projects\closedai`, using the session pooler URL:

```powershell
$env:DATABASE_URL="<SUPABASE_SESSION_POOLER_URL>?sslmode=require"
cd backend
C:\Projects\closedai\.venv\Scripts\python.exe -m alembic upgrade head
```

Run migrations before launching or publishing the backend. Render can run the same migration automatically with:

```text
alembic upgrade head
```

This repository includes `preDeployCommand: alembic upgrade head` in [render.yaml](render.yaml). Remove it if a paid Render plan or migration permissions require a separate one-off job.

## Render backend

1. Push the repository.
2. In Render, create a Blueprint from [render.yaml](render.yaml).
3. Render installs [backend/requirements.txt](backend/requirements.txt), which intentionally excludes local PyTorch and `sentence-transformers` dependencies.
4. Set every `sync: false` environment variable, using the transaction pooler URL for `DATABASE_URL`.
5. Run `alembic upgrade head` against the session pooler before deploying the web service.
6. Set `MODE=hosted`, `AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, and `EMBEDDING_PROVIDER=voyage`.
7. Set `EMBEDDING_DIM` to the dimension returned by the Voyage embedding model configured in `VOYAGE_EMBEDDING_MODEL`.
8. Set `CORS_ORIGINS=https://your-app.vercel.app` with no wildcard or localhost origin.
9. Deploy and verify `/health`, then `/ready`.

## Vercel frontend

1. Import `C:\Projects\closedai\frontend` as the Vercel project root or select `frontend` as the root directory.
2. The existing [next.config.mjs](frontend/next.config.mjs) needs no deployment-specific adapter and no `vercel.json` is required.
3. Set these Vercel environment variables:
   - `NEXT_PUBLIC_API_URL=https://your-backend.onrender.com`
   - `NEXT_PUBLIC_AUTH_MODE=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<public anon key>`
   - `NEXT_PUBLIC_CONTACT_EMAIL`
   - `NEXT_PUBLIC_GITHUB_URL`
   - `NEXT_PUBLIC_GOOGLE_AUTH`
   - `NEXT_PUBLIC_SENTRY_DSN`
4. Redeploy after changing public environment variables.
5. Add the final Vercel URL to `CORS_ORIGINS` and Supabase Auth allowed redirect URLs.

## Pre-launch checklist

- [ ] Supabase Auth email providers and redirect URLs are configured.
- [ ] Storage bucket `documents` exists and is private.
- [ ] Session-pooler migration ran successfully.
- [ ] Render starts against the transaction pooler and `/ready` returns `ready`.
- [ ] Database vector dimension matches `EMBEDDING_DIM`.
- [ ] Hosted CORS contains only HTTPS Vercel origins.
- [ ] `SUPABASE_SERVICE_KEY` exists only as a backend secret.
- [ ] Render and Vercel secrets contain placeholders in source control only.
- [ ] Payment notification and admin email settings are correct.
- [ ] Docs remain disabled unless explicitly enabled.

## Smoke tests

1. Open the Vercel app and sign up through Supabase.
2. Upload a PDF and confirm ingestion reaches `ready`.
3. Ask a question and confirm a grounded answer is returned.
4. Submit an upgrade/payment request.
5. Approve the request in the admin UI.
6. Delete the account, confirm the app signs out, and verify owned data is removed.
