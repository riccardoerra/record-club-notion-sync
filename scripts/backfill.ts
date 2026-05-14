/**
 * Enriches existing Albums pages with MusicBrainz metadata.
 */

import { Client } from "@notionhq/client";
import { SCHEMA } from "../src/albums-schema.js";
import { fetchAlbumMeta, MUSICBRAINZ_USER_AGENT } from "../src/musicbrainz.js";
import { buildMetaProps } from "../src/notion-props.js";
import type { ReleaseKind } from "../src/record-club.js";
import { notionClient, requireEnv, resolveDataSourceId } from "./lib.js";

interface AlbumPage {
	id: string;
	title: string;
	artist: string;
	kind: ReleaseKind;
	hasMeta: boolean;
	hasCover: boolean;
}

function textProp(prop: any): string {
	return (prop?.rich_text ?? prop?.title ?? []).map((t: any) => t.plain_text).join("").trim();
}

function normalizeKind(name: string | null | undefined): ReleaseKind {
	if (name === "EP") return "EP";
	if (name === "Single" || name === "single") return "Single";
	return "Album";
}

async function ensureMetadataProperties(notion: Client, dataSourceId: string) {
	const source = await notion.request<any>({ path: `data_sources/${dataSourceId}`, method: "get" });
	const existing = source.properties ?? {};
	const missing: Record<string, any> = {};
	for (const [name, config] of Object.entries(SCHEMA)) {
		if (existing[name]) continue;
		missing[name] = config;
	}
	if (!Object.keys(missing).length) return 0;
	await notion.request({
		path:   `data_sources/${dataSourceId}`,
		method: "patch",
		body:   { properties: missing },
	});
	return Object.keys(missing).length;
}

async function* pages(notion: Client, dataSourceId: string): AsyncGenerator<AlbumPage> {
	let cursor: string | undefined;
	do {
		const r = await notion.request<any>({
			path:   `data_sources/${dataSourceId}/query`,
			method: "post",
			body: {
				page_size:    100,
				start_cursor: cursor,
			},
		});
		for (const p of r.results as any[]) {
			const props = p.properties ?? {};
			const title = textProp(props.Title);
			const artist = textProp(props.Artist);
			if (!title || !artist) continue;
			yield {
				id: p.id,
				title,
				artist,
				kind: normalizeKind(props.Kind?.select?.name),
				hasMeta: Boolean(props["Release Date"]?.date),
				hasCover: Boolean(p.cover),
			};
		}
		cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
	} while (cursor);
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const notion = notionClient();
	const databaseId = requireEnv("ALBUMS_DATABASE_ID");
	const force = process.argv.includes("--force");
	const dataSourceId = await resolveDataSourceId(notion, databaseId);

	console.log("Adding metadata properties if needed...");
	const addedProps = await ensureMetadataProperties(notion, dataSourceId);
	if (addedProps) console.log(`Added ${addedProps} properties.`);

	let scanned = 0, enriched = 0, skipped = 0, failed = 0;
	for await (const page of pages(notion, dataSourceId)) {
		scanned++;
		if (page.hasMeta && !force) {
			skipped++;
			continue;
		}

		try {
			await sleep(1200);
			const meta = await fetchAlbumMeta(page.title, page.artist, page.kind);
			if (!meta) {
				console.log(`[${scanned}] no match: ${page.artist} - ${page.title}`);
				failed++;
				continue;
			}

			const body: any = {
				page_id: page.id,
				properties: buildMetaProps(meta),
			};
			if (!page.hasCover && meta.cover) {
				body.cover = { type: "external", external: { url: meta.cover } };
			}
			await notion.pages.update(body);
			enriched++;
			console.log(`[${scanned}] enriched: ${page.artist} - ${page.title} (${meta.releaseYear ?? "?"})`);
		} catch (e: any) {
			failed++;
			console.log(`[${scanned}] failed: ${page.artist} - ${page.title}: ${e.message}`);
		}
	}

	console.log(`\nDone. scanned=${scanned} enriched=${enriched} skipped=${skipped} failed=${failed}`);
	console.log(`MusicBrainz requests use: ${MUSICBRAINZ_USER_AGENT}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
