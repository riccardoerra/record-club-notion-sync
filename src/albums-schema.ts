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
	{ name: "Listened", color: "green"  as const },
];

export const KIND_OPTIONS = [
	{ name: "Album",  color: "default" as const },
	{ name: "EP",     color: "gray"    as const },
	{ name: "Single", color: "brown"   as const },
];

export const SCHEMA: Record<string, any> = {
	Title:                { title: {} },
	Artist:               { rich_text: {} },
	Kind:                 { select: { options: KIND_OPTIONS } },
	"Release Date":       { date: {} },
	"Duration in minutes": { number: { format: "number" } },
	"Track Count":        { number: { format: "number" } },
	Labels:               { multi_select: { options: [] } },
	Genres:               { multi_select: { options: [] } },
	"Spotify Link":       { url: {} },
	Status:               { select: { options: STATUS_OPTIONS } },
	"Added Date":         { date: {} },
	"Listened Date":      { date: {} },
	Rating:               { select: { options: RATING_OPTIONS } },
	Review:               { rich_text: {} },
};

const PROPERTY_ORDER = [
	"Artist",
	"Kind",
	"Release Date",
	"Duration in minutes",
	"Track Count",
	"Labels",
	"Genres",
	"Spotify Link",
	"Status",
	"Added Date",
	"Listened Date",
	"Rating",
	"Review",
];

export function viewPayloads(databaseId: string, dataSourceId: string) {
	const galleryConfig = {
		type:         "gallery",
		properties:   [
			{ property_id: "title", visible: true },
			{ property_id: "Artist", visible: true, card_property_width_mode: "full_line" },
		],
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
			sorts: [{ property: "Added Date", direction: "descending" }],
		},
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "Listened", type: "gallery",
			configuration: galleryConfig,
			filter: {
				and: [
					{ property: "Status", select: { equals: "Listened" } },
					{ property: "Rating", select: { is_not_empty: true } },
				],
			},
			sorts: [{ property: "Listened Date", direction: "descending" }],
		},
		{
			database_id: databaseId, data_source_id: dataSourceId,
			name: "All Albums", type: "table",
			configuration: {
				type:       "table",
				properties: PROPERTY_ORDER.map((property_id) => ({ property_id, visible: true })),
			},
			sorts: [{ property: "Added Date", direction: "descending" }],
		},
	];
}
