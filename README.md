# record.club → Notion

Sync your public record.club activity RSS feed into a Notion Albums database. The worker imports queue additions, rotation additions, and listened/rated diary activity with cover images, ratings, listened dates, and review text when present.

This project is adapted from Brian Lovin's [`letterboxd-notion-sync`](https://github.com/brianlovin/letterboxd-notion-sync) Notion Worker pattern. The source integration and Notion schema have been replaced for record.club albums.

## What Syncs

- Queue activity → `Status = Queued`
- Rotation activity → `Status = Rotation`
- Listened/rated diary activity → `Status = Listened`
- Matching is based on the canonical record.club release slug, so a later listened/rated entry updates an earlier queued row.

record.club RSS is activity-based. It does not expose queue removals or a complete current queue snapshot, so this sync does not mirror deletions.

Important: record.club only emits the listened/rated RSS item when the release is added to your diary/reviews activity. Marking something as listened is not enough by itself. A diary entry can have an empty review body, but it needs at least a rating and listened date to appear as listened/rated RSS activity.

## Setup

```bash
curl -fsSL https://ntn.dev | bash
ntn login
```

```bash
npm install
npm run setup
```

Setup asks for a Notion Personal Access Token and your record.club username, creates a `💿 Albums` database with Queue / Rotation / Listened / All Albums views, deploys the worker, and triggers the first sync.

## Lazymode

Paste this repo link into Claude Code, Codex, or another coding agent and ask:

```text
Set this up for me: https://github.com/riccardoerra/record-club-notion-sync

Use my record.club username YOUR_USERNAME. Guide me through the Notion token / Notion Workers setup and deploy the worker.
```

The agent should clone the repo, install dependencies, run `npm run setup`, help you provide a Notion token, deploy the worker, and trigger the first sync.

For listened/rated albums to sync, add the release to your record.club diary/reviews activity with a rating and listened date. Simply marking a release as listened does not emit the RSS event this worker uses.

## Maintenance

```bash
ntn workers sync trigger recordClubSync
ntn workers sync status
ntn workers runs list
```

Edit `schedule: "1d"` in `src/index.ts` and run `ntn workers deploy` to change the cadence.
