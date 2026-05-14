/**
 * record.club → Notion sync.
 *
 * Daily worker that pulls a public record.club user RSS feed and writes queue,
 * rotation, and listened/rated release activity into an Albums database.
 *
 * Configuration (worker secrets via `ntn workers env push`)
 * ─────────────────────────────────────────────────────────
 *   RECORD_CLUB_USER   — your record.club username (e.g. "riccardoerra")
 *   ALBUMS_DATABASE_ID — Notion database ID of your Albums DB (UUID)
 *   NOTION_API_TOKEN   — integration token with access to the Albums DB
 */

import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

import {
	parseRecordClubRss,
	statusRank,
	type ReleaseEntry,
} from "./record-club.js";
import { fetchAlbumMeta } from "./musicbrainz.js";
import { buildAlbumProps, buildMetaProps } from "./notion-props.js";

// ---------- Config ---------------------------------------------------------

const RECORD_CLUB_USER   = process.env.RECORD_CLUB_USER   ?? "";
const ALBUMS_DATABASE_ID = process.env.ALBUMS_DATABASE_ID ?? "";

function assertEnv() {
	const missing = (["RECORD_CLUB_USER", "ALBUMS_DATABASE_ID"] as const)
		.filter(n => !process.env[n]);
	if (missing.length) throw new Error(
		`Missing env: ${missing.join(", ")}. Set with: ntn workers env set <KEY>=<VALUE>`,
	);
}

const worker = new Worker();
export default worker;

// ---------- Audit-log database (managed by the worker) --------------------

const syncRuns = worker.database("syncRuns", {
	type: "managed",
	initialTitle: "💿 record.club sync runs",
	primaryKeyProperty: "Run ID",
	schema: {
		properties: {
			"Run ID":  Schema.title(),
			Started:   Schema.date(),
			Added:     Schema.number(),
			Updated:   Schema.number(),
			Errors:    Schema.number(),
			Notes:     Schema.richText(),
		},
	},
});

// ---------- Rate limit -----------------------------------------------------

const recordClub = worker.pacer("recordClub", {
	allowedRequests: 2,
	intervalMs: 1000,
});

const musicBrainz = worker.pacer("musicBrainz", {
	allowedRequests: 1,
	intervalMs: 1200,
});

const NOTES_MAX_CHARS = 1900;

interface ExistingEntry {
	pageId: string;
	status: string | null;
}

// ---------- record.club fetcher -------------------------------------------

async function fetchRecordClubRss(): Promise<string> {
	await recordClub.wait();
	const url = `https://record.club/${RECORD_CLUB_USER}/rss`;
	const r = await fetch(url, {
		headers: {
			"User-Agent": "RecordClubNotionSync/1.0",
			"Accept":     "application/rss+xml, application/xml",
		},
	});
	if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
	return r.text();
}

// ---------- Notion database read ------------------------------------------

async function readExistingAlbums(notion: any): Promise<Map<string, ExistingEntry>> {
	const map = new Map<string, ExistingEntry>();
	let cursor: string | undefined;
	do {
		const r: any = await notion.databases.query({
			database_id:  ALBUMS_DATABASE_ID,
			page_size:    100,
			start_cursor: cursor,
		});
		for (const p of r.results) {
			const slug = (p.properties?.["Record Club Slug"]?.rich_text ?? [])
				.map((t: any) => t.plain_text)
				.join("")
				.trim();
			const canonical = p.properties?.["Canonical URI"]?.url ?? "";
			const key = slug || canonical;
			if (!key) continue;
			map.set(key, {
				pageId: p.id,
				status: p.properties?.Status?.select?.name ?? null,
			});
		}
		cursor = r.has_more ? r.next_cursor : undefined;
	} while (cursor);
	return map;
}

function shouldUpdate(existing: ExistingEntry, incoming: ReleaseEntry) {
	const currentRank = existing.status === "Listened" ? 3 : existing.status === "Rotation" ? 2 : 1;
	return statusRank(incoming.status) >= currentRank;
}

function truncate(s: string, n = 80): string {
	if (!s) return "";
	return s.length > n ? s.slice(0, n) + "..." : s;
}

async function enrichAlbum(e: ReleaseEntry) {
	try {
		await musicBrainz.wait();
		return await fetchAlbumMeta(e.title, e.artist, e.kind);
	} catch {
		return null;
	}
}

// ---------- The sync -------------------------------------------------------

worker.sync("recordClubSync", {
	database: syncRuns,
	mode:     "incremental",
	schedule: "1d",
	execute:  async (_state, { notion }) => {
		const started = new Date();
		const runId   = `run-${started.toISOString().replace(/[:.]/g, "-")}`;
		let added = 0, updated = 0, errors = 0;
		const notes: string[] = [];

		try { assertEnv(); } catch (e: any) {
			errors++;
			notes.push(e.message);
			return logRun(runId, started, added, updated, errors, notes);
		}

		let existing: Map<string, ExistingEntry>;
		try {
			existing = await readExistingAlbums(notion);
			notes.push(`existing=${existing.size}`);
		} catch (e: any) {
			errors++;
			notes.push(`READ_DB_FAILED: ${e.message}`);
			return logRun(runId, started, added, updated, errors, notes);
		}

		try {
			const entries = parseRecordClubRss(await fetchRecordClubRss());
			notes.push(`rss=${entries.length}`);

			// Oldest first lets a later listened/rated item upgrade an earlier
			// queue row during the same run.
			for (const e of entries.reverse()) {
				const key = e.slug || e.canonicalUrl;
				const ex = existing.get(key);
				try {
					if (!ex) {
						const meta = await enrichAlbum(e);
						const params: any = {
							parent: { database_id: ALBUMS_DATABASE_ID },
							properties: { ...buildAlbumProps(e), ...buildMetaProps(meta) },
						};
						const cover = e.cover ?? meta?.cover;
						if (cover) params.cover = { type: "external", external: { url: cover } };
						const created = await notion.pages.create(params);
						existing.set(key, { pageId: created.id, status: e.status });
						added++;
					} else if (shouldUpdate(ex, e)) {
						const meta = await enrichAlbum(e);
						const params: any = {
							page_id: ex.pageId,
							properties: { ...buildAlbumProps(e), ...buildMetaProps(meta) },
						};
						const cover = e.cover ?? meta?.cover;
						if (cover) params.cover = { type: "external", external: { url: cover } };
						await notion.pages.update(params);
						existing.set(key, { pageId: ex.pageId, status: e.status });
						updated++;
					}
				} catch (err: any) {
					errors++;
					notes.push(`rss[${e.title}]: ${truncate(err.message)}`);
				}
			}
		} catch (e: any) {
			errors++;
			notes.push(`RSS_FAILED: ${e.message}`);
		}

		return logRun(runId, started, added, updated, errors, notes);
	},
});

function logRun(
	runId: string,
	started: Date,
	added: number,
	updated: number,
	errors: number,
	notes: string[],
) {
	return {
		changes: [{
			type: "upsert" as const,
			key: runId,
			properties: {
				"Run ID":  Builder.title(runId),
				Started:   Builder.date(started.toISOString().slice(0, 10)),
				Added:     Builder.number(added),
				Updated:   Builder.number(updated),
				Errors:    Builder.number(errors),
				Notes:     Builder.richText(truncate(notes.join("; "), NOTES_MAX_CHARS)),
			},
		}],
		hasMore: false,
	};
}
