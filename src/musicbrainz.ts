import type { ReleaseKind } from "./record-club.js";

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";

export const MUSICBRAINZ_USER_AGENT =
	"record-club-notion-sync/0.1 (https://github.com/riccardoerra/record-club-notion-sync)";

export interface AlbumMeta {
	releaseDate: string | null;
	releaseYear: number | null;
	albumType: string | null;
	secondaryTypes: string[];
	genres: string[];
	tags: string[];
	labels: string[];
	country: string | null;
	barcode: string | null;
	trackCount: number | null;
	durationMins: number | null;
	musicBrainzReleaseGroupId: string | null;
	musicBrainzReleaseId: string | null;
	musicBrainzUrl: string | null;
	spotifyUrl: string | null;
	bandcampUrl: string | null;
	cover: string | null;
	matchScore: number | null;
}

interface FetchJson {
	(url: string): Promise<any>;
}

function uniq(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))];
}

function queryValue(s: string): string {
	return s.replace(/"/g, "");
}

function normalizeKind(kind: ReleaseKind): string {
	if (kind === "EP") return "EP";
	if (kind === "Single") return "Single";
	return "Album";
}

function artistNames(entity: any): string[] {
	return uniq((entity?.["artist-credit"] ?? [])
		.map((credit: any) => credit.artist?.name ?? credit.name));
}

function externalUrl(relations: any[] | undefined, host: string): string | null {
	const rel = (relations ?? []).find((r: any) => typeof r.url?.resource === "string" && r.url.resource.includes(host));
	return rel?.url?.resource ?? null;
}

function releaseGroupUrl(id: string | null): string | null {
	return id ? `https://musicbrainz.org/release-group/${id}` : null;
}

async function defaultFetchJson(url: string): Promise<any> {
	const r = await fetch(url, {
		headers: {
			"User-Agent": MUSICBRAINZ_USER_AGENT,
			"Accept":     "application/json",
		},
	});
	if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
	return r.json();
}

export function selectBestRelease(releases: any[] | undefined): any | null {
	const list = releases ?? [];
	return (
		list.find((r) => r.status === "Official" && r.date) ??
		list.find((r) => r.date) ??
		list.find((r) => r.status === "Official") ??
		list[0] ??
		null
	);
}

export function buildAlbumMeta(releaseGroup: any, release: any | null): AlbumMeta {
	const releaseGroupId = releaseGroup?.id ?? null;
	const releaseId = release?.id ?? null;
	const date = release?.date ?? releaseGroup?.["first-release-date"] ?? null;
	const year = date ? parseInt(String(date).slice(0, 4), 10) : NaN;
	const tracks = (release?.media ?? []).flatMap((m: any) => m.tracks ?? []);
	const totalMs = tracks.reduce((sum: number, t: any) => sum + (t.length ?? t.recording?.length ?? 0), 0);

	return {
		releaseDate: date,
		releaseYear: Number.isFinite(year) ? year : null,
		albumType: releaseGroup?.["primary-type"] ?? null,
		secondaryTypes: releaseGroup?.["secondary-types"] ?? [],
		genres: uniq([...(releaseGroup?.genres ?? []), ...(release?.genres ?? [])].map((g: any) => g.name)).slice(0, 12),
		tags: uniq([...(releaseGroup?.tags ?? []), ...(release?.tags ?? [])].map((g: any) => g.name)).slice(0, 12),
		labels: uniq((release?.["label-info"] ?? []).map((x: any) => x.label?.name)).slice(0, 8),
		country: release?.country ?? null,
		barcode: release?.barcode && release.barcode !== "[none]" ? release.barcode : null,
		trackCount: tracks.length || null,
		durationMins: totalMs ? Math.round(totalMs / 60000) : null,
		musicBrainzReleaseGroupId: releaseGroupId,
		musicBrainzReleaseId: releaseId,
		musicBrainzUrl: releaseGroupUrl(releaseGroupId),
		spotifyUrl: externalUrl(release?.relations, "open.spotify.com") ?? externalUrl(releaseGroup?.relations, "open.spotify.com"),
		bandcampUrl: externalUrl(release?.relations, "bandcamp.com") ?? externalUrl(releaseGroup?.relations, "bandcamp.com"),
		cover: null,
		matchScore: releaseGroup?.score ?? null,
	};
}

export async function fetchArtistGenres(
	artist: string,
	fetchJson: FetchJson = defaultFetchJson,
): Promise<string[]> {
	const query = `artist:"${queryValue(artist)}"`;
	const searchUrl = `${MB_BASE}/artist?fmt=json&limit=1&query=${encodeURIComponent(query)}`;
	const search = await fetchJson(searchUrl);
	const hit = search.artists?.[0];
	if (!hit?.id || (typeof hit.score === "number" && hit.score < 90)) return [];
	const artistUrl = `${MB_BASE}/artist/${hit.id}?fmt=json&inc=genres+tags`;
	const full = await fetchJson(artistUrl);
	return uniq((full.genres ?? []).map((g: any) => g.name)).slice(0, 8);
}

export async function fetchAlbumMeta(
	title: string,
	artist: string,
	kind: ReleaseKind,
	fetchJson: FetchJson = defaultFetchJson,
): Promise<AlbumMeta | null> {
	const query = `releasegroup:"${queryValue(title)}" AND artist:"${queryValue(artist)}"`;
	const searchUrl = `${MB_BASE}/release-group?fmt=json&limit=3&query=${encodeURIComponent(query)}`;
	const search = await fetchJson(searchUrl);
	const hit = (search["release-groups"] ?? []).find((rg: any) => rg?.["primary-type"] === normalizeKind(kind)) ??
		(search["release-groups"] ?? [])[0];
	if (!hit) return null;

	const rgUrl = `${MB_BASE}/release-group/${hit.id}?fmt=json&inc=artists+genres+tags+releases+url-rels`;
	const releaseGroup = await fetchJson(rgUrl);
	const best = selectBestRelease(releaseGroup.releases);
	let release: any | null = null;
	if (best?.id) {
		const releaseUrl = `${MB_BASE}/release/${best.id}?fmt=json&inc=recordings+media+labels+artist-credits+release-groups+genres+tags+url-rels`;
		release = await fetchJson(releaseUrl);
	}
	const meta = buildAlbumMeta({ ...hit, ...releaseGroup, score: hit.score ?? releaseGroup.score ?? null }, release);
	if (meta.genres.length === 0) {
		for (const name of artistNames(releaseGroup).slice(0, 3)) {
			const genres = await fetchArtistGenres(name, fetchJson);
			for (const genre of genres) {
				if (!meta.genres.includes(genre)) meta.genres.push(genre);
			}
			if (meta.genres.length >= 8) {
				meta.genres = meta.genres.slice(0, 8);
				break;
			}
		}
	}
	if (meta.musicBrainzReleaseId) {
		try {
			const r = await fetch(`${CAA_BASE}/release/${meta.musicBrainzReleaseId}/front-500`, {
				method:   "HEAD",
				redirect: "follow",
				headers:  { "User-Agent": MUSICBRAINZ_USER_AGENT },
			});
			if (r.ok) meta.cover = r.url;
		} catch {
			// Cover art is optional enrichment.
		}
	}
	return meta;
}
