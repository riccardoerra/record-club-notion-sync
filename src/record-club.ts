/**
 * Pure parsers for record.club RSS feeds.
 *
 * record.club exposes public user activity at /USER/rss. The feed includes
 * queue, rotation, list, follow, and listened/rated activity. We only model
 * release activity needed for the Notion album database.
 */

export type ReleaseKind = "Album" | "EP" | "Single";
export type ReleaseStatus = "Queued" | "Rotation" | "Listened";

export interface ReleaseEntry {
	title:        string;
	artist:       string;
	kind:         ReleaseKind;
	status:       ReleaseStatus;
	url:          string;
	canonicalUrl: string;
	slug:         string;
	cover:        string | null;
	activityDate: string | null;
	listenedDate: string | null;
	rating:       string | null;
	ratingValue:  number | null;
	review:       string | null;
}

export const STAR_RATING_VALUE: Record<string, number> = {
	"★★★★★": 5,
	"★★★★½": 4.5,
	"★★★★": 4,
	"★★★½": 3.5,
	"★★★": 3,
	"★★½": 2.5,
	"★★": 2,
	"★½": 1.5,
	"★": 1,
	"½": 0.5,
};

// ---------- XML/HTML primitives -------------------------------------------

export function decodeXmlEntities(s: string): string {
	return s
		.replace(/&amp;/g,  "&")
		.replace(/&lt;/g,   "<")
		.replace(/&gt;/g,   ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
		.replace(/&nbsp;/g,  " ");
}

function unwrapCdata(s: string): string {
	const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
	return m ? m[1] : s;
}

function getTag(block: string, tag: string): string {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag.split(":")[0]}(?::[^>]*)?>`);
	const m = re.exec(block);
	return m ? decodeXmlEntities(unwrapCdata(m[1])).trim() : "";
}

function getEnclosureUrl(block: string): string | null {
	const tag = /<enclosure\b[^>]*>/i.exec(block)?.[0];
	if (!tag) return null;
	return /url="([^"]+)"/.exec(tag)?.[1] ?? null;
}

export function stripHtml(html: string): string {
	return decodeXmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function isoDateFromPubDate(pubDate: string): string | null {
	if (!pubDate) return null;
	const d = new Date(pubDate);
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoDateFromLongDate(dateText: string): string | null {
	const d = new Date(`${dateText} 00:00:00 UTC`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function canonicalReleaseUrl(url: string): string {
	const m = /https:\/\/record\.club\/(?:[^/]+\/)?releases\/(albums|eps|singles)\/([^/?#]+)/.exec(url);
	if (!m) return url;
	const path = m[1] === "albums" ? "albums" : m[1];
	return `https://record.club/releases/${path}/${m[2]}`;
}

export function slugFromReleaseUrl(url: string): string {
	const clean = canonicalReleaseUrl(url);
	return clean.split("/").filter(Boolean).at(-1) ?? clean;
}

function kindPath(kind: ReleaseKind) {
	if (kind === "EP") return "eps";
	if (kind === "Single") return "singles";
	return "albums";
}

function extractCanonicalFromContent(content: string): string | null {
	const links = [...content.matchAll(/href="([^"]+)"/g)].map((m) => decodeXmlEntities(m[1]));
	return links.find((u) => /^https:\/\/record\.club\/releases\//.test(u)) ?? null;
}

function extractListenedDate(content: string): string | null {
	const text = stripHtml(content);
	const m = /Listened:\s+([A-Za-z]+ \d{1,2}, \d{4})/.exec(text);
	return m ? isoDateFromLongDate(m[1]) : null;
}

function extractReview(content: string): string | null {
	const withoutImage = content.replace(/<p><img\b[^>]*><\/p>/i, "");
	const withoutLinks = withoutImage.replace(/<p><a href="https:\/\/record\.club\/[^"]+">[^<]+<\/a>\.<\/p>/gi, "");
	const withoutListened = withoutLinks.replace(/<p>\s*Listened:\s+[A-Za-z]+ \d{1,2}, \d{4}\s*<\/p>/i, "");
	const text = stripHtml(withoutListened);
	return text || null;
}

function releaseRegex(action: "queue" | "rotation" | "listened") {
	if (action === "listened") {
		return /^.+ listened to and rated an? (album|EP|single): '(.+)' by (.+) - ([★½]+)$/;
	}
	return new RegExp(`^.+ added an? (album|EP|single) to (?:his|her|their) ${action}: '(.+)' by (.+)$`);
}

function normalizeKind(raw: string): ReleaseKind {
	return raw === "EP" ? "EP" : raw === "single" ? "Single" : "Album";
}

function parseReleaseTitle(title: string): { kind: ReleaseKind; status: ReleaseStatus; title: string; artist: string; rating: string | null; ratingValue: number | null } | null {
	const listened = releaseRegex("listened").exec(title);
	if (listened) {
		const rating = listened[4];
		return {
			kind: normalizeKind(listened[1]),
			status: "Listened",
			title: listened[2],
			artist: listened[3],
			rating,
			ratingValue: STAR_RATING_VALUE[rating] ?? null,
		};
	}

	const queue = releaseRegex("queue").exec(title);
	if (queue) {
		return {
			kind: normalizeKind(queue[1]),
			status: "Queued",
			title: queue[2],
			artist: queue[3],
			rating: null,
			ratingValue: null,
		};
	}

	const rotation = releaseRegex("rotation").exec(title);
	if (rotation) {
		return {
			kind: normalizeKind(rotation[1]),
			status: "Rotation",
			title: rotation[2],
			artist: rotation[3],
			rating: null,
			ratingValue: null,
		};
	}

	return null;
}

// ---------- RSS parser -----------------------------------------------------

export function parseRecordClubRss(xml: string): ReleaseEntry[] {
	const out: ReleaseEntry[] = [];
	for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
		const block = m[1];
		const titleText = getTag(block, "title");
		const parsed = parseReleaseTitle(titleText);
		if (!parsed) continue;

		const link = getTag(block, "link");
		const content = getTag(block, "content:encoded");
		const canonical = canonicalReleaseUrl(extractCanonicalFromContent(content) ?? link);
		const url = link || canonical || `https://record.club/releases/${kindPath(parsed.kind)}/${slugFromReleaseUrl(canonical)}`;

		out.push({
			...parsed,
			url,
			canonicalUrl: canonical || canonicalReleaseUrl(url),
			slug: slugFromReleaseUrl(canonical || url),
			cover: getEnclosureUrl(block),
			activityDate: isoDateFromPubDate(getTag(block, "pubDate")),
			listenedDate: parsed.status === "Listened" ? extractListenedDate(content) : null,
			review: parsed.status === "Listened" ? extractReview(content) : null,
		});
	}
	return out;
}

export function statusRank(status: ReleaseStatus): number {
	if (status === "Listened") return 3;
	if (status === "Rotation") return 2;
	return 1;
}
