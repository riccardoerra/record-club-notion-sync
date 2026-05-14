/**
 * Schema + view definitions for the Albums database.
 */

export const RATING_OPTIONS = [
	{ name: "★★★★★", color: "yellow" as const },
	{ name: "★★★★½", color: "yellow" as const },
	{ name: "★★★★",  color: "yellow" as const },
	{ name: "★★★½",  color: "yellow" as const },
	{ name: "★★★",   color: "yellow" as const },
	{ name: "★★½",   color: "yellow" as const },
	{ name: "★★",    color: "yellow" as const },
	{ name: "★½",    color: "yellow" as const },
	{ name: "★",     color: "yellow" as const },
	{ name: "½",     color: "yellow" as const },
];

export const STATUS_OPTIONS = [
	{ name: "Queued",   color: "blue"   as const },
	{ name: "Rotation", color: "purple" as const },
	{ name: "Listened", color: "green"  as const },
];

export const KIND_OPTIONS = [
	{ name: "album",  color: "default" as const },
	{ name: "EP",     color: "gray"    as const },
	{ name: "single", color: "brown"   as const },
];

export const SCHEMA: Record<string, any> = {
	Title:                { title: {} },
	Artist:               { rich_text: {} },
	Kind:                 { select: { options: KIND_OPTIONS } },
	Status:               { select: { options: STATUS_OPTIONS } },
	Rating:               { select: { options: RATING_OPTIONS } },
	"Rating Value":       { number: { format: "number" } },
	"Listened Date":      { date: {} },
	"Activity Date":      { date: {} },
	Review:               { rich_text: {} },
	"Record Club URI":    { url: {} },
	"Canonical URI":      { url: {} },
	"Record Club Slug":   { rich_text: {} },
	"Release Date":       { date: {} },
	"Release Year":       { number: { format: "number" } },
	"Album Type":         { select: { options: [] } },
	"Secondary Types":    { multi_select: { options: [] } },
	Genres:               { multi_select: { options: [] } },
	Tags:                 { multi_select: { options: [] } },
	Labels:               { multi_select: { options: [] } },
	Country:              { rich_text: {} },
	Barcode:              { rich_text: {} },
	"Track Count":        { number: { format: "number" } },
	"Duration minutes":   { number: { format: "number" } },
	"MusicBrainz RGID":   { rich_text: {} },
	"MusicBrainz RID":    { rich_text: {} },
	MusicBrainz:          { url: {} },
	Spotify:              { url: {} },
	Bandcamp:             { url: {} },
	"MB Match Score":     { number: { format: "number" } },
};

export function viewPayloads(databaseId: string, dataSourceId: string) {
	const galleryConfig = {
		type:         "gallery",
		cover:        { type: "page_cover" },
		cover_size:   "medium",
		cover_aspect: "cover",
		card_layout:  "compact",
	};
	return [
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "Queue", type: "gallery",
			configuration: galleryConfig,
			filter: { property: "Status", select: { equals: "Queued" } },
			sorts: [{ property: "Activity Date", direction: "descending" }],
		},
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "Rotation", type: "gallery",
			configuration: galleryConfig,
			filter: { property: "Status", select: { equals: "Rotation" } },
			sorts: [{ property: "Activity Date", direction: "descending" }],
		},
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "Listened", type: "gallery",
			configuration: galleryConfig,
			filter: { property: "Status", select: { equals: "Listened" } },
			sorts: [{ property: "Listened Date", direction: "descending" }],
		},
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "All Albums", type: "table",
			configuration: { type: "table" },
			sorts: [{ property: "Activity Date", direction: "descending" }],
		},
	];
}
