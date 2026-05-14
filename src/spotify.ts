export interface SpotifyAlbumMatch {
	url: string;
	id: string;
	name: string;
	artistNames: string[];
	score: number;
}

interface TokenCache {
	token: string;
	expiresAt: number;
}

let cache: TokenCache | null = null;

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function includesArtist(needle: string, candidates: string[]): boolean {
	const n = normalize(needle);
	return candidates.some((candidate) => {
		const c = normalize(candidate);
		return c === n || c.includes(n) || n.includes(c);
	});
}

export function scoreSpotifyAlbum(inputTitle: string, inputArtist: string, album: any): number {
	let score = 0;
	if (normalize(album.name ?? "") === normalize(inputTitle)) score += 70;
	else if (normalize(album.name ?? "").includes(normalize(inputTitle))) score += 40;

	const artists = (album.artists ?? []).map((a: any) => a.name).filter(Boolean);
	if (includesArtist(inputArtist, artists)) score += 30;

	return score;
}

async function spotifyToken(clientId: string, clientSecret: string): Promise<string> {
	const now = Date.now();
	if (cache && cache.expiresAt > now + 60_000) return cache.token;

	const body = new URLSearchParams({ grant_type: "client_credentials" });
	const auth = btoa(`${clientId}:${clientSecret}`);
	const r = await fetch("https://accounts.spotify.com/api/token", {
		method:  "POST",
		headers: {
			"Authorization": `Basic ${auth}`,
			"Content-Type":  "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!r.ok) throw new Error(`Spotify token -> ${r.status}`);
	const json: any = await r.json();
	cache = {
		token: json.access_token,
		expiresAt: now + (json.expires_in ?? 3600) * 1000,
	};
	return cache.token;
}

export async function searchSpotifyAlbum(
	title: string,
	artist: string,
	clientId = process.env.SPOTIFY_CLIENT_ID ?? "",
	clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "",
): Promise<SpotifyAlbumMatch | null> {
	if (!clientId || !clientSecret) return null;

	const token = await spotifyToken(clientId, clientSecret);
	const q = `album:${title} artist:${artist}`;
	const url = `https://api.spotify.com/v1/search?type=album&limit=5&q=${encodeURIComponent(q)}`;
	const r = await fetch(url, {
		headers: { "Authorization": `Bearer ${token}` },
	});
	if (!r.ok) throw new Error(`Spotify search -> ${r.status}`);
	const json: any = await r.json();
	const items = json.albums?.items ?? [];
	const ranked = items
		.map((album: any) => ({ album, score: scoreSpotifyAlbum(title, artist, album) }))
		.sort((a: any, b: any) => b.score - a.score);
	const best = ranked[0];
	if (!best || best.score < 70) return null;
	return {
		url: best.album.external_urls?.spotify ?? `https://open.spotify.com/album/${best.album.id}`,
		id: best.album.id,
		name: best.album.name,
		artistNames: (best.album.artists ?? []).map((a: any) => a.name).filter(Boolean),
		score: best.score,
	};
}

