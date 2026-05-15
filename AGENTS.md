# record-club-notion-sync

Notion Worker that syncs record.club queue and listened/rated diary activity into a Notion Albums database. See [README.md](./README.md) for user-facing docs.

## Rules

- Keep parser logic pure in `src/record-club.ts`.
- Keep Notion schema/view changes in `src/albums-schema.ts`.
- Do not hardcode user-specific values; use `RECORD_CLUB_USER`, `ALBUMS_DATABASE_ID`, and `NOTION_API_TOKEN`.
- Match records by kind, artist, and title. record.club RSS links are activity URLs, so the canonical release slug is only metadata.
- Do not try to mirror queue removals unless record.club exposes a current queue source; RSS is activity-based.

## Verification

- `npm run check` — type-check (no emit)
- `npm test` — unit tests, against fixtures only (~150ms, no network)

CI (`.github/workflows/ci.yml`) runs `check` + `test` on every push/PR.

## Don't

- **Hardcode user-specific values** (record.club username, database IDs) anywhere in `src/` or `scripts/` — they live in env vars.
- **Commit `.env`.** It's git-ignored; use `.env.example` for documentation.
- **Assume a plain "marked listened" action appears in RSS.** The listened/rated RSS event requires record.club diary/review activity.
- **Broad `any` in parser/domain logic.** Keep loose Notion SDK response shapes at the integration boundary only.
