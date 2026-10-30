# Ownership route audit

| Route | Audit result |
|---|---|
| `POST /documents/upload-url` | PASS |
| `POST /documents` | PASS |
| `POST /documents/register` | PASS |
| `GET /documents` | PASS |
| `GET /documents/{id}` | PASS |
| `POST /documents/{id}/retry` | PASS |
| `DELETE /documents/{id}` | PASS |
| `POST /chat` | PASS |
| `GET /conversations` | PASS |
| `GET /conversations/{id}` | PASS |
| `DELETE /conversations/{id}` | PASS |
| `GET /units` | PASS |
| `POST /units` | PASS |
| `PATCH /units/{id}` | PASS |
| `DELETE /units/{id}` | PASS |
| `GET /billing/requests` | PASS |
| `POST /billing/requests` | PASS |
| `GET /me/usage` | PASS |
| `GET /me/export` | PASS |
| `DELETE /me` | PASS |

Message reads use both the conversation id and an ownership join to the current user. Every ownership-sensitive mutation uses the user's id. Admin routes intentionally operate on global rows only after admin authorization.
