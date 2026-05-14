/**
 * One-command setup. Creates the Albums database, writes .env, and deploys
 * the worker. Designed to be run by a non-technical user from a fresh clone.
 *
 *   npm run setup
 *
 * Idempotent / resumable: if a previous run got partway, re-running picks
 * up where it left off. Pass `--force` to wipe `.env` and start over.
 */

import { Client } from "@notionhq/client";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as readline from "node:readline/promises";

import { NOTION_VERSION } from "./lib";
import { SCHEMA, viewPayloads } from "../src/albums-schema";

const FORCE      = process.argv.includes("--force");
const SKIP_DEPLOY = process.argv.includes("--no-deploy"); // useful for testing

// ---------- Pretty-print helpers ------------------------------------------

const C = {
	dim:   (s: string) => `\x1b[2m${s}\x1b[0m`,
	bold:  (s: string) => `\x1b[1m${s}\x1b[0m`,
	red:   (s: string) => `\x1b[31m${s}\x1b[0m`,
	green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function step(s: string)    { console.log(`\n${C.bold("▸")} ${C.bold(s)}`); }
function info(s: string)    { console.log(`  ${s}`); }
function ok(s: string)      { console.log(`  ${C.green("✓")} ${s}`); }
function fail(s: string)    { console.log(`  ${C.red("✗")} ${s}`); }
function bail(s: string): never { console.error(`\n${C.red("✗")} ${s}`); process.exit(1); }

// Extract a UUID from a Notion URL or accept a bare UUID. Notion URLs embed
// the id as the last 32-hex-char segment, optionally prefixed by human text
// and a hyphen.
function extractNotionId(input: string): string | null {
	const m = input.trim().match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
	if (!m) return null;
	const hex = m[1].replace(/-/g, "").toLowerCase();
	if (hex.length !== 32) return null;
	return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// ---------- Prompts --------------------------------------------------------

async function prompt(rl: readline.Interface, question: string, fallback?: string): Promise<string> {
	const suffix = fallback ? C.dim(` [${fallback}]`) : "";
	const answer = (await rl.question(`  ${question}${suffix}: `)).trim();
	return answer || fallback || "";
}

// ---------- ntn shell-out helpers -----------------------------------------

function hasNtn(): boolean {
	const r = spawnSync("ntn", ["--version"], { stdio: "ignore" });
	return r.status === 0;
}

function ntnAuthed(): boolean {
	// `ntn doctor` writes its checklist to stderr, not stdout.
	const r = spawnSync("ntn", ["doctor"], { encoding: "utf8" });
	const out = (r.stdout ?? "") + (r.stderr ?? "");
	return r.status === 0 && /Token valid\s+✔/.test(out);
}

function runNtn(args: string[], { capture = false }: { capture?: boolean } = {}): string | null {
	const r = spawnSync("ntn", args, {
		stdio:    capture ? ["inherit", "pipe", "pipe"] : "inherit",
		encoding: "utf8",
	});
	if (r.status !== 0) {
		bail(`\`ntn ${args.join(" ")}\` failed (exit ${r.status}). See the output above.`);
	}
	return capture ? r.stdout ?? "" : null;
}

// ---------- .env helpers ---------------------------------------------------

function readDotenv(path: string): Record<string, string> {
	if (!fs.existsSync(path)) return {};
	const out: Record<string, string> = {};
	for (const line of fs.readFileSync(path, "utf8").split("\n")) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
		if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
	return out;
}

function writeDotenv(path: string, vars: Record<string, string>) {
	const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
	fs.writeFileSync(path, lines.join("\n") + "\n");
}

// ---------- record.club username sanity check -----------------------------

async function checkRecordClubUser(user: string): Promise<{ ok: boolean; reason?: string; itemCount?: number }> {
	const r = await fetch(`https://record.club/${user}/rss`, {
		headers: { "User-Agent": "RecordClubNotionSync setup", "Accept": "application/rss+xml" },
	});
	if (r.status === 404) return { ok: false, reason: `no record.club user named "${user}"` };
	if (!r.ok)            return { ok: false, reason: `record.club returned ${r.status}` };
	const xml = await r.text();
	const items = xml.match(/<item>/g)?.length ?? 0;
	return { ok: true, itemCount: items };
}

// ---------- Main -----------------------------------------------------------

async function main() {
	console.log(C.bold("\nrecord.club → Notion setup"));
	console.log(C.dim("─────────────────────────"));

	// ---------- Preflight: ntn CLI ----------
	if (!hasNtn()) {
		bail(
			`The "ntn" CLI is required and not found in your PATH.\n` +
			`Install it with:\n\n` +
			`    curl -fsSL https://ntn.dev | bash\n\n` +
			`Then re-run \`npm run setup\`.`,
		);
	}
	if (!ntnAuthed()) runNtn(["login"]);

	// ---------- Force handling ----------
	if (FORCE && fs.existsSync(".env")) {
		fs.unlinkSync(".env");
		ok(`Removed existing .env (--force)`);
	}

	const existing = readDotenv(".env");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	// ---------- Step 1 — Notion token ----------
	step("Notion access token");
	console.log(C.dim(`  https://notion.so/developers/tokens → New personal access token`));
	console.log(C.dim(`  → tick Notion API + Workers → Create → copy`));
	let token = existing.NOTION_API_TOKEN ?? "";
	if (!token) token = await prompt(rl, "Token");
	if (!token.startsWith("ntn_")) bail(`Token doesn't look right — should start with "ntn_".`);

	const notion = new Client({ auth: token, notionVersion: NOTION_VERSION });

	// Detect token type. Both PATs and internal integrations come back as
	// `type: "bot"`; the differentiator is `bot.owner.type`:
	//   • PAT             → bot.owner.type === "user"  (acts as a person;
	//                       can create at workspace root)
	//   • Internal integ. → bot.owner.type === "workspace"  (can't create
	//                       at workspace root; needs a parent page)
	let tokenIsPat = false;
	try {
		const me = await notion.request<any>({ path: "users/me", method: "get" });
		tokenIsPat = me?.bot?.owner?.type === "user";
		const who = tokenIsPat
			? (me?.bot?.owner?.user?.name ?? me?.name ?? "your account")
			: (me?.bot?.workspace_name ?? me?.name ?? "your workspace");
		ok(`Authenticated as ${C.bold(who)}${tokenIsPat ? "" : C.dim(" (integration token)")}`);
	} catch (e: any) {
		bail(`Notion didn't accept that token (${e.message}). Try generating a new one.`);
	}

	// ---------- Step 2 — record.club username ----------
	step("record.club username");
	let recordClubUser = existing.RECORD_CLUB_USER ?? "";
	while (true) {
		recordClubUser = await prompt(rl, "Username", recordClubUser);
		if (!recordClubUser) { fail("Please enter your record.club username."); continue; }
		const check = await checkRecordClubUser(recordClubUser);
		if (check.ok) {
			ok(`Found ${check.itemCount ?? 0} recent activity items`);
			break;
		}
		fail(`${check.reason} — try again`);
	}

	// ---------- Step 3 — Database + views ----------
	step("Creating database");
	let databaseId   = existing.ALBUMS_DATABASE_ID ?? "";
	let dataSourceId = "";
	let databaseUrl  = "";

	if (databaseId) {
		// Resume path: DB already exists from a previous run.
		try {
			const db = await notion.request<any>({ path: `databases/${databaseId}`, method: "get" });
			dataSourceId = db.data_sources?.[0]?.id ?? "";
			databaseUrl  = db.url ?? "";
			ok(`Reusing existing database ${C.bold("💿 Albums")} (from .env)`);
		} catch {
			bail(`.env has ALBUMS_DATABASE_ID=${databaseId} but Notion can't find it. Run with --force to start over.`);
		}
	} else {
		// Pick a parent. PATs can create at the workspace root; integration
		// tokens have to create as a child of a page they're already shared
		// with, so we prompt for one.
		let parent: any;
		if (tokenIsPat) {
			parent = { type: "workspace", workspace: true };
		} else {
			console.log(C.dim(`  Your integration can't create databases at the workspace root.`));
			console.log(C.dim(`  Open any page in your workspace, click ⋯ → Connections → Add`));
			console.log(C.dim(`  your integration, then paste the page URL here.`));
			let parentPageId: string | null = null;
			while (!parentPageId) {
				const raw = await prompt(rl, "Parent page URL");
				parentPageId = extractNotionId(raw);
				if (!parentPageId) { fail("Couldn't find a Notion ID in that. Try again."); continue; }
				try {
					await notion.request({ path: `pages/${parentPageId}`, method: "get" });
				} catch (e: any) {
					fail(`Can't read that page (${e.message}). Did you add the integration via Connections?`);
					parentPageId = null;
				}
			}
			parent = { type: "page_id", page_id: parentPageId };
		}

		const db = await notion.request<any>({
			path: "databases", method: "post",
			body: {
				parent,
				title: [{ type: "text", text: { content: "💿 Albums" } }],
				initial_data_source: { properties: SCHEMA },
			},
		});
		databaseId   = db.id;
		dataSourceId = db.data_sources?.[0]?.id;
		databaseUrl  = db.url ?? `https://www.notion.so/${databaseId.replace(/-/g, "")}`;
		if (!dataSourceId) bail("Notion created the database but didn't return a data source ID.");
		ok(`Created ${C.bold("💿 Albums")} at workspace root`);

		// Persist immediately so a partial failure in view creation /
		// deploy doesn't orphan the database.
		writeDotenv(".env", {
			NOTION_API_TOKEN:   token,
			RECORD_CLUB_USER:   recordClubUser,
			ALBUMS_DATABASE_ID: databaseId,
		});

		// Create our three views.
		const ourViewIds = new Set<string>();
		for (const v of viewPayloads(databaseId, dataSourceId)) {
			try {
				const created = await notion.request<any>({ path: "views", method: "post", body: v });
				if (created?.id) ourViewIds.add(created.id);
			} catch (e: any) {
				fail(`View "${v.name}" failed: ${e.message}`);
			}
		}
		ok(`Views: Queue, Rotation, Listened, All Albums`);

		// Delete the auto-created default view.
		try {
			const listed = await notion.request<any>({
				path: `views?database_id=${databaseId}`, method: "get",
			});
			for (const v of listed?.results ?? []) {
				if (!ourViewIds.has(v.id)) {
					await notion.request({ path: `views/${v.id}`, method: "delete" });
				}
			}
			ok(`Removed default view`);
		} catch {
			// non-fatal
		}
	}

	// Refresh .env (capturing any token / username updates from the resume path).
	writeDotenv(".env", {
		NOTION_API_TOKEN:   token,
		RECORD_CLUB_USER:   recordClubUser,
		ALBUMS_DATABASE_ID: databaseId,
	});

	rl.close();

	// ---------- Step 4 — Deploy worker ----------
	step("Deploying worker");

	if (SKIP_DEPLOY) {
		info(`--no-deploy passed; skipping the ntn deploy step.`);
	} else {
		// Create the worker record (no-op if workers.json already exists).
		if (!fs.existsSync("workers.json")) {
			runNtn(["workers", "create", "--name", "record-club-notion-sync"]);
		}
		// Deploy first so the worker's capability descriptor declares which
		// env keys it reads — `env push` validates against that descriptor
		// and rejects keys the deployed code doesn't reference. The worker
		// tolerates missing env at module load (assertEnv fires inside the
		// sync execute, not at import).
		runNtn(["workers", "deploy"]);
		runNtn(["workers", "env", "push", "--yes"]);
		ok(`Worker deployed (runs daily)`);

		// Kick off the first sync immediately so the database starts filling
		// up while the user is reading the "done" message. spawnSync waits;
		// that's fine here, the sync is fast.
		runNtn(["workers", "sync", "trigger", "recordClubSync"]);
		ok(`First sync triggered — open the database below to watch albums arrive`);
	}

	// ---------- Done ----------
	console.log(`\n${C.bold(C.green("Setup complete."))}`);
	console.log(`\n  Your database: ${C.bold(databaseUrl)}\n`);
	console.log(C.dim(`  RSS is activity-based; queue removals are not exposed by record.club RSS.`));
	console.log();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
