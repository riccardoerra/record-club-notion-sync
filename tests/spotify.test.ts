import { test } from "node:test";
import * as assert from "node:assert/strict";

import { scoreSpotifyAlbum } from "../src/spotify";

test("scoreSpotifyAlbum prefers exact title and artist matches", () => {
	const score = scoreSpotifyAlbum("Little Wide Open", "Kevin Morby", {
		name: "Little Wide Open",
		artists: [{ name: "Kevin Morby" }],
	});
	assert.equal(score, 100);
});

test("scoreSpotifyAlbum rejects unrelated albums", () => {
	const score = scoreSpotifyAlbum("Little Wide Open", "Kevin Morby", {
		name: "Different Record",
		artists: [{ name: "Someone Else" }],
	});
	assert.equal(score, 0);
});

