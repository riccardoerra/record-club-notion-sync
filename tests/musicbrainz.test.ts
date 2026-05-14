import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
	buildAlbumMeta,
	fetchAlbumMeta,
	selectBestRelease,
} from "../src/musicbrainz";

test("selectBestRelease prefers dated official releases", () => {
	assert.equal(selectBestRelease([
		{ id: "draft", status: null },
		{ id: "official-undated", status: "Official" },
		{ id: "official-dated", status: "Official", date: "2026-03-27" },
	])?.id, "official-dated");
});

test("buildAlbumMeta maps MusicBrainz release metadata", () => {
	const meta = buildAlbumMeta(
		{
			id: "rgid",
			score: 100,
			"first-release-date": "2026-03-27",
			"primary-type": "Album",
			"secondary-types": ["Compilation"],
			genres: [{ name: "synth-pop" }],
			tags: [{ name: "pop" }],
			relations: [{ url: { resource: "https://open.spotify.com/album/example" } }],
		},
		{
			id: "rid",
			date: "2026-03-28",
			country: "XW",
			barcode: "123",
			"label-info": [{ label: { name: "Young" } }],
			genres: [{ name: "dance-pop" }],
			media: [{
				tracks: [
					{ title: "One", length: 60000 },
					{ title: "Two", recording: { length: 120000 } },
				],
			}],
			relations: [{ url: { resource: "https://artist.bandcamp.com/album/example" } }],
		},
	);

	assert.equal(meta.releaseDate, "2026-03-28");
	assert.equal(meta.releaseYear, 2026);
	assert.equal(meta.albumType, "Album");
	assert.deepEqual(meta.secondaryTypes, ["Compilation"]);
	assert.deepEqual(meta.genres, ["synth-pop", "dance-pop"]);
	assert.deepEqual(meta.tags, ["pop"]);
	assert.deepEqual(meta.labels, ["Young"]);
	assert.equal(meta.trackCount, 2);
	assert.equal(meta.durationMins, 3);
	assert.equal(meta.musicBrainzUrl, "https://musicbrainz.org/release-group/rgid");
	assert.equal(meta.spotifyUrl, "https://open.spotify.com/album/example");
	assert.equal(meta.bandcampUrl, "https://artist.bandcamp.com/album/example");
	assert.equal(meta.cover, null);
	assert.equal(meta.matchScore, 100);
});

test("fetchAlbumMeta searches release groups and fetches the best release", async () => {
	const calls: string[] = [];
	const meta = await fetchAlbumMeta("Sexistential", "Robyn", "album", async (url) => {
		calls.push(url);
		if (url.includes("/release-group?")) {
			return { "release-groups": [{ id: "rgid", score: 100, "primary-type": "Album" }] };
		}
		if (url.includes("/release-group/rgid")) {
			return {
				id: "rgid",
				"primary-type": "Album",
				releases: [{ id: "rid", status: "Official", date: "2026-03-27" }],
			};
		}
		if (url.includes("/release/rid")) {
			return { id: "rid", date: "2026-03-27", media: [{ tracks: [{ length: 60000 }] }] };
		}
		throw new Error(`unexpected ${url}`);
	});

	assert.equal(meta?.musicBrainzReleaseGroupId, "rgid");
	assert.equal(meta?.musicBrainzReleaseId, "rid");
	assert.equal(meta?.trackCount, 1);
	assert.equal(calls.length, 3);
	assert.match(calls[0], /Sexistential/);
});
