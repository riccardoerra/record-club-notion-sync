import type { AlbumMeta } from "./musicbrainz.js";
import type { ReleaseEntry } from "./record-club.js";

export function richText(s: string | null) {
	return s
		? { rich_text: [{ type: "text", text: { content: s.slice(0, 2000) } }] }
		: { rich_text: [] };
}

export function multiSelect(values: string[]) {
	return {
		multi_select: values
			.map((name) => name.trim().slice(0, 100))
			.filter(Boolean)
			.map((name) => ({ name })),
	};
}

export function urlProp(url: string | null) {
	return { url };
}

export function numberProp(n: number | null) {
	return { number: n };
}

export function buildAlbumProps(entry: ReleaseEntry) {
	const props: Record<string, any> = {
		Title:              { title: [{ text: { content: entry.title } }] },
		Artist:             richText(entry.artist),
		Kind:               { select: { name: entry.kind } },
		Status:             { select: { name: entry.status } },
	};
	if (entry.activityDate) props["Added Date"] = { date: { start: entry.activityDate } };
	if (entry.listenedDate) props["Listened Date"] = { date: { start: entry.listenedDate } };
	if (entry.rating)       props.Rating           = { select: { name: entry.rating } };
	if (entry.review)       props.Review           = richText(entry.review);
	return props;
}

export function buildMetaProps(meta: AlbumMeta | null) {
	if (!meta) return {};
	const props: Record<string, any> = {
		Genres:             multiSelect(meta.genres),
		Labels:             multiSelect(meta.labels),
		"Track Count":      numberProp(meta.trackCount),
		"Duration minutes": numberProp(meta.durationMins),
		Spotify:            urlProp(meta.spotifyUrl),
	};
	if (meta.releaseDate) props["Release Date"] = { date: { start: meta.releaseDate } };
	return props;
}
