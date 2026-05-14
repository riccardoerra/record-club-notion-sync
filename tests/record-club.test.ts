import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
	canonicalReleaseUrl,
	decodeXmlEntities,
	parseRecordClubRss,
	STAR_RATING_VALUE,
	stripHtml,
} from "../src/record-club";

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
	<channel>
		<item>
			<title><![CDATA[Riccardo Erra listened to and rated an album: 'Sexistential' by Robyn - ★★★½]]></title>
			<link>https://record.club/riccardoerra/releases/albums/robyn-sexistential</link>
			<guid>https://record.club/riccardoerra/releases/albums/robyn-sexistential</guid>
			<pubDate>Thu, 14 May 2026 10:43:21 GMT</pubDate>
			<content:encoded><![CDATA[<p><img src="https://cdn.rcrd.club/releases/cover.jpg?width=480" alt="" /></p>
				<p>Listened: May 14, 2026</p>
				<p>Brief review text.</p>
				<p><a href="https://record.club/releases/albums/robyn-sexistential">View on Record Club</a>.</p>]]></content:encoded>
			<enclosure url="https://cdn.rcrd.club/releases/cover.jpg?width=480" length="0" type="image/jpg"/>
		</item>
		<item>
			<title><![CDATA[Riccardo Erra added an album to his queue: 'Little Wide Open' by Kevin Morby]]></title>
			<link>https://record.club/releases/albums/kevin-morby-little-wide-open</link>
			<guid>https://record.club/releases/albums/kevin-morby-little-wide-open</guid>
			<pubDate>Thu, 14 May 2026 10:05:13 GMT</pubDate>
			<content:encoded><![CDATA[<p><img src="https://cdn.rcrd.club/releases/queue.jpg?width=480" alt="" /></p> <p><a href="https://record.club/releases/albums/kevin-morby-little-wide-open">Read more on Record Club</a>.</p>]]></content:encoded>
			<enclosure url="https://cdn.rcrd.club/releases/queue.jpg?width=480" length="0" type="image/jpg"/>
		</item>
		<item>
			<title><![CDATA[fione added an EP to his rotation: 'I Did' by Yves]]></title>
			<link>https://record.club/releases/eps/yves-i-did</link>
			<pubDate>Fri, 13 Feb 2026 10:00:00 GMT</pubDate>
			<content:encoded><![CDATA[<p><img src="https://cdn.rcrd.club/releases/ep.jpg?width=480" alt="" /></p>]]></content:encoded>
			<enclosure url="https://cdn.rcrd.club/releases/ep.jpg?width=480" length="0" type="image/jpg"/>
		</item>
		<item>
			<title><![CDATA[Riccardo Erra followed a user: fione (@fionn)]]></title>
			<link>https://record.club/fionn</link>
		</item>
	</channel>
</rss>`;

test("decodeXmlEntities handles common entities", () => {
	assert.equal(decodeXmlEntities("Foo &amp; Bar"), "Foo & Bar");
	assert.equal(decodeXmlEntities("&quot;hi&quot;"), `"hi"`);
	assert.equal(decodeXmlEntities("can&apos;t"), "can't");
	assert.equal(decodeXmlEntities("caf&#233;"), "café");
});

test("stripHtml converts content HTML to text", () => {
	assert.equal(stripHtml("<p>Hello &amp; goodbye</p>"), "Hello & goodbye");
});

test("canonicalReleaseUrl strips username releases prefix", () => {
	assert.equal(
		canonicalReleaseUrl("https://record.club/riccardoerra/releases/albums/robyn-sexistential"),
		"https://record.club/releases/albums/robyn-sexistential",
	);
});

test("STAR_RATING_VALUE maps half-star strings", () => {
	assert.equal(STAR_RATING_VALUE["★★★½"], 3.5);
});

test("parseRecordClubRss extracts release activity and skips social activity", () => {
	const entries = parseRecordClubRss(rss);
	assert.equal(entries.length, 2);

	assert.deepEqual(entries[0], {
		title: "Sexistential",
		artist: "Robyn",
		kind: "Album",
		status: "Listened",
		url: "https://record.club/riccardoerra/releases/albums/robyn-sexistential",
		canonicalUrl: "https://record.club/releases/albums/robyn-sexistential",
		slug: "robyn-sexistential",
		cover: "https://cdn.rcrd.club/releases/cover.jpg?width=480",
		activityDate: "2026-05-14",
		listenedDate: "2026-05-14",
		rating: "★★★½",
		ratingValue: 3.5,
		review: "Brief review text.",
	});

	assert.equal(entries[1].status, "Queued");
	assert.equal(entries[1].title, "Little Wide Open");
	assert.equal(entries[1].artist, "Kevin Morby");
});
