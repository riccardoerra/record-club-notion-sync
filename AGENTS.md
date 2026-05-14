# record-club-notion-sync

Notion Worker that syncs record.club queue, rotation, and listened/rated diary activity into a Notion Albums database. See [README.md](./README.md) for user-facing docs.

## Rules

- Keep parser logic pure in `src/record-club.ts`.
- Keep Notion schema/view changes in `src/albums-schema.ts`.
- Do not hardcode user-specific values; use `RECORD_CLUB_USER`, `ALBUMS_DATABASE_ID`, and `NOTION_API_TOKEN`.
- Match records by canonical record.club release slug, not just title/artist.
- Do not try to mirror queue removals unless record.club exposes a current queue source; RSS is activity-based.

## Verification

- `npm run check` — type-check (no emit)
- `npm test` — unit tests, against fixtures only (~150ms, no network)

CI (`.github/workflows/ci.yml`) runs `check` + `test` on every push/PR.

## Don't

- **Hardcode user-specific values** (record.club username, database IDs) anywhere in `src/` or `scripts/` — they live in env vars.
- **Commit `.env`.** It's git-ignored; use `.env.example` for documentation.
- **Assume a plain "marked listened" action appears in RSS.** The listened/rated RSS event requires record.club diary/review activity.
- **`as any` to silence Notion SDK types** — the types compile when called correctly; a TS error means the call shape is wrong.
