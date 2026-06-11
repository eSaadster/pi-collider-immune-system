import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const API_BASE = "https://en.wikipedia.org/w/api.php";
// One Action API call returns 20 random article intros; the per-article REST
// random/summary endpoint rate-limits concurrent callers with 429s.
const RANDOM_API_URL =
	`${API_BASE}?action=query&format=json&formatversion=2` +
	"&generator=random&grnnamespace=0&grnfilterredir=nonredirects&grnlimit=20" +
	"&prop=extracts%7Cdescription%7Cinfo&exintro=1&explaintext=1&exlimit=max&inprop=url";
const USER_AGENT = "open-collider-pi-extension/1.0 (https://github.com/eSaadster/pi-collider-immune-system)";
const MIN_EXTRACT_CHARS = 350;
const MAX_DRAW_ROUNDS = 3;
const RECENT_LOG_WINDOW = 40;

// Mechanism-dense index pages whose outgoing links form the curated draw pool.
const SEED_LISTS = [
	"List of paradoxes",
	"List of cognitive biases",
	"List of fallacies",
	"List of eponymous laws",
	"List of thought experiments",
	"Philosophical razor",
	"Glossary of game theory",
	"List of games in game theory",
	"List of effects",
	"Glossary of economics",
	"Glossary of philosophy",
];
const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POOL_PAGES_PER_LIST = 3; // pllimit=max returns 500 links per request
const EXTRACT_BATCH = 18; // prop=extracts with exintro caps exlimit at 20 per query
const WILDCARD_SLOTS = 1;
const CANDIDATE_TARGET = 24; // pool candidates gathered before structural selection

// Abstract structural primitives used by Phase 0. The question is tagged with
// these (out-of-band LLM call, never enters the session transcript), and pool
// candidates are selected for instantiating the same primitives. Primitives
// leak structure, not content, so Phase A stays blind to the actual question.
const PRIMITIVES: { key: string; hint: string }[] = [
	{ key: "feedback-loop", hint: "self-reinforcing or self-correcting cycles; compounding; spirals" },
	{ key: "threshold-cascade", hint: "tipping points, phase transitions, nonlinear cascades" },
	{ key: "scarcity-allocation", hint: "contested finite resources; prioritization; queues; bottlenecks" },
	{ key: "principal-agent", hint: "misaligned incentives between deciders and doers; delegation drift" },
	{ key: "signaling-screening", hint: "costly signals, credibility, information asymmetry, reputation" },
	{ key: "selection-filtering", hint: "variation plus selective survival; survivorship distortions" },
	{ key: "arms-race", hint: "adversarial co-adaptation; escalation; countermeasures" },
	{ key: "redundancy-fragility", hint: "robustness, backups, single points of failure, cascading failure" },
	{ key: "asymmetric-leverage", hint: "power laws, winner-take-all, small causes with outsized effects" },
	{ key: "coordination-commons", hint: "collective action, free riding, shared-resource depletion" },
	{ key: "gating-quarantine", hint: "boundaries, membranes, controlled exposure, staged admission" },
	{ key: "explore-exploit", hint: "search versus optimization; diversification versus focus" },
	{ key: "path-dependence", hint: "lock-in, irreversibility, hysteresis, switching costs" },
	{ key: "emergence-composition", hint: "interacting parts producing qualitatively new wholes" },
];

// Wildcard (true-random) draws must positively look like a concept/mechanism;
// pool draws are already curated, so they only need to dodge obvious junk
// (seed lists link to contextual pages too, e.g. people mentioned in a paradox).
const DESCRIPTION_ALLOWLIST =
	/\b(concept|theory|theorem|principle|paradox|phenomenon|effect|law|bias|heuristic|strategy|strategies|problem|method|model|fallacy|dilemma|razor|adage|maxim|hypothesis|experiment|game theory|argument|rule|reasoning|logic|economics|philosophy|psychology|mechanism|process|system|technique|framework)\b/i;
const DESCRIPTION_BLOCKLIST =
	/\b(footballer|cricketer|athlete|politician|singer|songwriter|actor|actress|musician|rapper|novelist|poet|painter|journalist|album|song|single|film|movie|tour|band|tv series|television series|episode|video game|role-playing game|board game|card game|comics|manga|village|town|city|municipality|district|county|country|continent|island|ocean|planet|river|lake|mountain|species|genus|gene|protein|railway|station|stadium|church|school|university|surname|given name|football club|monarch|emperor|dictator|philosopher|theologian|economist|mathematician|physicist|chemist|biologist|scientist|psychologist|sociologist|historian|scholar)\b/i;
const PERSON_YEARS = /\(\s*born\b|\bborn \d{4}|\b\d{2,4}\s*[–—-]\s*\d{2,4}\s*(?:BC|BCE|AD|CE)?\s*\)/i;

type Mode = "standard" | "deep";

// near: all slots structurally conditioned, no wildcard.
// mid (default): conditioned pool slots + 1 unconditioned wildcard.
// far: fully unconditioned draw (original behavior).
type Distance = "near" | "mid" | "far";

type Source = {
	title: string;
	description: string;
	extract: string;
	url: string;
	origin: string;
};

type LogEntry = {
	timestamp: number;
	mode: Mode;
	question: string;
	sources: { title: string; url: string; origin?: string }[];
	verdict: string | null;
	distance?: Distance;
	primitives?: string[];
};

type ActiveCollision = {
	question: string;
	mode: Mode;
	phase: "A" | "B";
	sources: Source[];
	distance: Distance;
	primitives: string[] | null;
};

type PoolEntry = { title: string; list: string };
type Pool = { builtAt: number; entries: PoolEntry[] };

function logPath(cwd: string): string {
	return join(cwd, ".pi", "open-collider", "collisions.jsonl");
}

function poolPath(cwd: string): string {
	return join(cwd, ".pi", "open-collider", "pool.json");
}

function ensureLogFile(cwd: string): string {
	const file = logPath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	if (!existsSync(file)) writeFileSync(file, "", "utf8");
	return file;
}

function loadLog(cwd: string): LogEntry[] {
	const raw = readFileSync(ensureLogFile(cwd), "utf8");
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = JSON.parse(line) as LogEntry;
				if (!parsed.question || !Array.isArray(parsed.sources)) return [];
				return [parsed];
			} catch {
				return [];
			}
		});
}

function appendLog(cwd: string, entry: LogEntry): void {
	appendFileSync(ensureLogFile(cwd), `${JSON.stringify(entry)}\n`, "utf8");
}

function rateLastEntry(cwd: string, verdict: string): LogEntry | null {
	const entries = loadLog(cwd);
	if (entries.length === 0) return null;
	entries[entries.length - 1].verdict = verdict;
	writeFileSync(ensureLogFile(cwd), entries.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
	return entries[entries.length - 1];
}

function recentTitles(cwd: string): Set<string> {
	const titles = new Set<string>();
	for (const entry of loadLog(cwd).slice(-RECENT_LOG_WINDOW)) {
		for (const source of entry.sources) titles.add(source.title.toLowerCase());
	}
	return titles;
}

function shuffle<T>(items: T[]): T[] {
	const arr = [...items];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

// Equal draw probability per seed list, so large glossaries (which link many
// broad survey articles) don't drown out the dense paradox/law/bias lists.
function interleaveByList(entries: PoolEntry[]): PoolEntry[] {
	const groups = new Map<string, PoolEntry[]>();
	for (const entry of shuffle(entries)) {
		const group = groups.get(entry.list) ?? [];
		group.push(entry);
		groups.set(entry.list, group);
	}
	const buckets = shuffle([...groups.values()]);
	const result: PoolEntry[] = [];
	for (let i = 0; result.length < entries.length; i++) {
		for (const bucket of buckets) {
			if (i < bucket.length) result.push(bucket[i]);
		}
	}
	return result;
}

function parsePage(page: any, origin: string): Source | null {
	const extract = typeof page?.extract === "string" ? page.extract.trim() : "";
	if (!extract) return null;
	return {
		title: String(page.title ?? "Untitled"),
		description: typeof page?.description === "string" ? page.description : "",
		extract,
		url: String(page.fullurl ?? ""),
		origin,
	};
}

function usable(source: Source): boolean {
	if (source.extract.length < MIN_EXTRACT_CHARS) return false;
	if (/disambiguation|topics referred to by the same term/i.test(source.description)) return false;
	if (/^(list|lists|index|glossary|outline|timeline) of /i.test(source.title)) return false;
	return true;
}

function passesPoolGate(source: Source): boolean {
	return (
		usable(source) &&
		!DESCRIPTION_BLOCKLIST.test(source.description) &&
		!PERSON_YEARS.test(source.description)
	);
}

function passesWildcardGate(source: Source): boolean {
	return passesPoolGate(source) && DESCRIPTION_ALLOWLIST.test(source.description);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(params: URLSearchParams): Promise<any> {
	// Wikipedia 429s rapid sequential callers; back off and retry before failing.
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${API_BASE}?${params}`, {
			headers: { accept: "application/json", "user-agent": USER_AGENT },
		});
		if (res.ok) return res.json();
		if ((res.status === 429 || res.status >= 500) && attempt < 2) {
			await sleep(1500 * (attempt + 1));
			continue;
		}
		throw new Error(`Wikipedia API returned HTTP ${res.status}`);
	}
}

async function fetchSeedListLinks(list: string): Promise<string[]> {
	const titles: string[] = [];
	let plcontinue: string | undefined;
	for (let page = 0; page < POOL_PAGES_PER_LIST; page++) {
		const params = new URLSearchParams({
			action: "query",
			format: "json",
			formatversion: "2",
			prop: "links",
			titles: list,
			redirects: "1",
			pllimit: "max",
			plnamespace: "0",
		});
		if (plcontinue) params.set("plcontinue", plcontinue);
		const data = await apiGet(params);
		const links: any[] = data?.query?.pages?.[0]?.links ?? [];
		for (const link of links) {
			if (typeof link?.title === "string") titles.push(link.title);
		}
		plcontinue = data?.continue?.plcontinue;
		if (!plcontinue) break;
	}
	return titles;
}

async function buildPool(cwd: string): Promise<Pool> {
	// Sequential, not parallel: Wikipedia rate-limits concurrent callers with 429s.
	const results: { list: string; titles: string[] }[] = [];
	for (const list of SEED_LISTS) {
		try {
			results.push({ list, titles: await fetchSeedListLinks(list) });
		} catch {
			results.push({ list, titles: [] });
		}
	}
	const seen = new Set<string>();
	const entries: PoolEntry[] = [];
	for (const { list, titles } of results) {
		for (const title of titles) {
			const key = title.toLowerCase();
			if (seen.has(key)) continue;
			if (/^(list of|lists of|index of|glossary of|outline of|timeline of)/i.test(title)) continue;
			seen.add(key);
			entries.push({ title, list });
		}
	}
	const pool: Pool = { builtAt: Date.now(), entries };
	if (entries.length > 0) {
		const file = poolPath(cwd);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(pool), "utf8");
	}
	return pool;
}

function readCachedPool(cwd: string, ignoreTtl = false): Pool | null {
	const file = poolPath(cwd);
	if (!existsSync(file)) return null;
	try {
		const pool = JSON.parse(readFileSync(file, "utf8")) as Pool;
		if (!Array.isArray(pool.entries) || pool.entries.length === 0) return null;
		if (!ignoreTtl && Date.now() - pool.builtAt >= POOL_TTL_MS) return null;
		return pool;
	} catch {
		return null;
	}
}

async function loadPool(cwd: string, onBuild?: () => void): Promise<Pool> {
	const cached = readCachedPool(cwd);
	if (cached) return cached;
	onBuild?.();
	return buildPool(cwd);
}

async function fetchExtractsForEntries(entries: PoolEntry[]): Promise<Source[]> {
	if (entries.length === 0) return [];
	const params = new URLSearchParams({
		action: "query",
		format: "json",
		formatversion: "2",
		titles: entries.map((e) => e.title).join("|"),
		redirects: "1",
		prop: "extracts|description|info",
		exintro: "1",
		explaintext: "1",
		exlimit: "max",
		inprop: "url",
	});
	const data = await apiGet(params);

	// Map requested titles through normalization/redirects so each returned
	// page can be labeled with the seed list it came from.
	const rename = new Map<string, string>();
	for (const r of [...(data?.query?.normalized ?? []), ...(data?.query?.redirects ?? [])]) {
		if (r?.from && r?.to) rename.set(String(r.from), String(r.to));
	}
	const originByTitle = new Map<string, string>();
	for (const entry of entries) {
		let title = entry.title;
		for (let hop = 0; hop < 3; hop++) title = rename.get(title) ?? title;
		originByTitle.set(title.toLowerCase(), entry.list);
	}

	const pages: any[] = Array.isArray(data?.query?.pages) ? data.query.pages : [];
	return pages.flatMap((page) => {
		const source = parsePage(page, "curated pool");
		if (!source) return [];
		source.origin = originByTitle.get(source.title.toLowerCase()) ?? "curated pool";
		return [source];
	});
}

async function fetchRandomBatch(): Promise<Source[]> {
	const res = await fetch(RANDOM_API_URL, {
		headers: { accept: "application/json", "user-agent": USER_AGENT },
	});
	if (!res.ok) throw new Error(`Wikipedia API returned HTTP ${res.status}`);
	const data: any = await res.json();
	const pages: any[] = Array.isArray(data?.query?.pages) ? data.query.pages : [];
	return pages.flatMap((page) => {
		const source = parsePage(page, "wildcard");
		return source ? [source] : [];
	});
}

// Out-of-band LLM call via the session's current model. Never enters the
// session transcript, so the main conversation stays blind to it.
async function completeOnce(systemPrompt: string, userText: string, ctx: any): Promise<string | null> {
	try {
		const model = ctx.model;
		if (!model) return null;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth?.ok) return null;
		const response: any = await complete(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }],
			},
			{ apiKey: auth.apiKey, headers: auth.headers },
		);
		const text = (Array.isArray(response?.content) ? response.content : [])
			.filter((c: any) => c?.type === "text")
			.map((c: any) => c.text)
			.join("\n")
			.trim();
		return text || null;
	} catch {
		return null;
	}
}

function extractJsonArray(text: string): any[] | null {
	const match = text.match(/\[[\s\S]*?\]/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function tagQuestion(question: string, ctx: any): Promise<string[] | null> {
	const ontology = PRIMITIVES.map((p) => `- ${p.key}: ${p.hint}`).join("\n");
	const system = `You tag questions with structural primitives for a creative-collision tool. Given a question or problem statement, identify the 2-4 primitives that best describe its underlying structure: the forces, constraints, and dynamics actually at play beneath the surface topic.

Available primitives:
${ontology}

Reply with ONLY a JSON array of primitive keys, e.g. ["feedback-loop","scarcity-allocation"]. No prose.`;
	const text = await completeOnce(system, question, ctx);
	if (!text) return null;
	const keys = extractJsonArray(text);
	if (!keys || !keys.every((k) => typeof k === "string")) return null;
	const valid = [...new Set(keys)].filter((k) => PRIMITIVES.some((p) => p.key === k)).slice(0, 4);
	return valid.length > 0 ? valid : null;
}

// Pick the candidates that structurally fit the target primitives. The
// selector sees primitives and candidates, never the question itself.
async function selectByStructure(
	candidates: Source[],
	primitives: string[],
	take: number,
	ctx: any,
): Promise<Source[] | null> {
	if (candidates.length <= take) return candidates.slice(0, take);
	const hints = PRIMITIVES.filter((p) => primitives.includes(p.key))
		.map((p) => `- ${p.key}: ${p.hint}`)
		.join("\n");
	const listing = candidates
		.map(
			(c, i) =>
				`CANDIDATE ${i + 1}: ${c.title}${c.description ? ` — ${c.description}` : ""}\n${c.extract.slice(0, 500)}`,
		)
		.join("\n\n");
	const system = `You select source material for a creative-collision exercise. The target's structural primitives are:

${hints}

From the numbered candidates, choose the ${take} whose content most strongly contains an ACTIVE causal mechanism instantiating at least one target primitive — a real mechanism in the candidate's own domain, not a thematic or surface-keyword match. Prefer topically diverse picks. Reply with ONLY a JSON array of candidate numbers, e.g. [3, 7]. No prose.`;
	const text = await completeOnce(system, listing, ctx);
	if (!text) return null;
	const numbers = extractJsonArray(text);
	if (!numbers || !numbers.every((n) => typeof n === "number")) return null;
	const picked: Source[] = [];
	for (const n of numbers) {
		const candidate = candidates[n - 1];
		if (candidate && !picked.includes(candidate)) picked.push(candidate);
		if (picked.length >= take) break;
	}
	for (const candidate of candidates) {
		if (picked.length >= take) break;
		if (!picked.includes(candidate)) picked.push(candidate);
	}
	return picked.slice(0, take);
}

type DrawOptions = {
	count: number;
	wildcardSlots: number;
	primitives: string[] | null; // null => unconditioned draw
	exclude: Set<string>;
	ctx: any;
	onPoolBuild?: () => void;
};

async function drawSources(opts: DrawOptions): Promise<{ sources: Source[]; error: string | null }> {
	const { count, wildcardSlots, primitives, exclude, ctx } = opts;
	const sources: Source[] = [];
	const seen = new Set<string>();
	let error: string | null = null;

	const take = (source: Source, target: number, gate: (s: Source) => boolean): void => {
		if (sources.length >= target) return;
		const key = source.title.toLowerCase();
		if (seen.has(key) || exclude.has(key)) return;
		if (!gate(source)) return;
		seen.add(key);
		sources.push(source);
	};

	const pool = await loadPool(ctx.cwd, opts.onPoolBuild);
	const shuffled = interleaveByList(pool.entries).filter((e) => !exclude.has(e.title.toLowerCase()));
	let cursor = 0;

	// Gather gated pool candidates without committing them to slots.
	const nextCandidates = async (want: number): Promise<Source[]> => {
		const found: Source[] = [];
		let batches = 0;
		while (found.length < want && cursor < shuffled.length && batches < MAX_DRAW_ROUNDS + 1) {
			const batch = shuffled.slice(cursor, cursor + EXTRACT_BATCH);
			cursor += EXTRACT_BATCH;
			batches++;
			try {
				for (const source of await fetchExtractsForEntries(batch)) {
					const key = source.title.toLowerCase();
					if (seen.has(key) || exclude.has(key)) continue;
					if (!passesPoolGate(source)) continue;
					if (found.some((s) => s.title.toLowerCase() === key)) continue;
					found.push(source);
				}
			} catch (e: any) {
				error = e?.message ?? String(e);
			}
		}
		return found;
	};

	const poolSlots = Math.max(0, count - wildcardSlots);
	let leftovers: Source[] = [];

	if (primitives && poolSlots > 0) {
		const candidates = await nextCandidates(CANDIDATE_TARGET);
		const picked = await selectByStructure(candidates, primitives, poolSlots, ctx);
		if (!picked && candidates.length > 0) {
			ctx.ui.notify("Structural selection unavailable; using unconditioned pool picks.", "warning");
		}
		const chosen = picked ?? candidates.slice(0, poolSlots);
		for (const source of chosen) take(source, poolSlots, () => true);
		leftovers = candidates.filter((c) => !seen.has(c.title.toLowerCase()));
	} else {
		for (const source of await nextCandidates(poolSlots)) take(source, poolSlots, () => true);
	}

	// One true-random wildcard slot gated by the description allowlist.
	for (let round = 0; round < MAX_DRAW_ROUNDS && sources.length < count; round++) {
		try {
			for (const source of await fetchRandomBatch()) {
				take(source, count, passesWildcardGate);
			}
		} catch (e: any) {
			error = e?.message ?? String(e);
		}
	}

	// Backfill from unselected candidates, then fresh pool batches.
	for (const source of leftovers) take(source, count, () => true);
	if (sources.length < count) {
		for (const source of await nextCandidates(count - sources.length)) take(source, count, () => true);
	}

	return { sources, error };
}

function parseCollideArgs(args: string): { question: string; distance: Distance | null } {
	let distance: Distance | null = null;
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const eq = token.match(/^(?:--distance|-d)=(near|mid|far)$/i);
		if (eq) {
			distance = eq[1].toLowerCase() as Distance;
			continue;
		}
		if (/^(?:--distance|-d)$/i.test(token) && /^(near|mid|far)$/i.test(tokens[i + 1] ?? "")) {
			distance = tokens[++i].toLowerCase() as Distance;
			continue;
		}
		const short = token.match(/^--(near|mid|far)$/i);
		if (short) {
			distance = short[1].toLowerCase() as Distance;
			continue;
		}
		rest.push(token);
	}
	return { question: rest.join(" "), distance };
}

function phaseAPrompt(sources: Source[], mode: Mode): string {
	const list = sources
		.map(
			(s, i) =>
				`SOURCE ${i + 1}: ${s.title}${s.description ? ` — ${s.description}` : ""}\n${s.extract}\n(${s.url})`,
		)
		.join("\n\n");

	const intersectionStep =
		mode === "deep"
			? `\n3. Then derive the structural INTERSECTION of the mechanisms: a single composite causal principle that only exists where these unrelated mechanisms overlap. Name it precisely.`
			: "";

	return `[Open Collider — Phase A of 2: blind mechanism extraction]

The sources below were drawn at random from an external corpus. The user's actual question exists but is deliberately withheld until Phase B, so you cannot back-fit a domain to an idea you already have. Stay entirely inside each source's own domain.

${list}

For each source:
1. Identify the strongest ACTIVE causal mechanism in it — what causes what, through what chain. A mechanism, not a theme, vibe, or metaphor.
2. State what is counter-intuitive about it: where it cuts against naive expectation.${intersectionStep}

Rules:
- Do not guess at, mention, or angle toward any application, product, repo, or task.
- Do not generalize the mechanisms into business or software lessons.
- If a source is too thin to carry a real mechanism, say so plainly for that source.
- End your answer after the mechanisms. Phase B arrives next.`;
}

function phaseBPrompt(question: string, mode: Mode): string {
	const pick =
		mode === "deep"
			? "Use the INTERSECTION principle you derived in Phase A."
			: "Choose the ONE Phase A mechanism with the strongest structural (not surface or thematic) fit.";

	return `[Open Collider — Phase B of 2: collision]

The user's actual question:

"${question}"

Using only the mechanisms you elaborated in Phase A:

1. Restate the question in structural terms: the forces, constraints, incentives, feedback loops, asymmetries, and failure modes actually at play.
2. ${pick} If nothing genuinely fits, say so and recommend /reroll — a forced fake mapping is worse than no mapping.
3. Write the explicit mapping: which element of the source mechanism corresponds to which element of the question's structure.
4. Generate 2-4 collision-born ideas. For each:
   - the proposal
   - why it could not arise from answering the question directly
   - a concrete next step: an experiment, a question to investigate, a sketch, a prototype, a file to change — whatever fits the context
   - the strongest objection against it
5. Ablation check, one line per idea: delete the source mechanism from the idea — does the idea still stand on its own? If yes, discard it; it is generic advice wearing a costume.`;
}

function textFromMessage(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part?.type === "text" && typeof part.text === "string") return part.text;
				if (typeof part?.text === "string") return part.text;
				return "";
			})
			.join("\n");
	}
	return "";
}

function summarizeLog(entries: LogEntry[]): string {
	if (entries.length === 0) return "Collision log is empty. Run /collide <question> to start.";
	const lines = [`Collision log: ${entries.length} collision(s), newest last`];
	for (const entry of entries.slice(-15)) {
		const date = new Date(entry.timestamp).toISOString().slice(0, 10);
		const titles = entry.sources.map((s) => s.title).join(" + ");
		const verdict = entry.verdict ? ` — verdict: ${entry.verdict}` : "";
		const tag = entry.distance ? `${entry.mode}/${entry.distance}` : entry.mode;
		lines.push(`- [${date}] (${tag}) "${entry.question}" × ${titles}${verdict}`);
	}
	return lines.join("\n");
}

function summarizePool(pool: Pool | null): string {
	if (!pool) return "No source pool built yet. It is built on the first /collide, or run /collider-pool rebuild.";
	const counts = new Map<string, number>();
	for (const entry of pool.entries) counts.set(entry.list, (counts.get(entry.list) ?? 0) + 1);
	const ageDays = Math.max(0, Math.round((Date.now() - pool.builtAt) / 86_400_000));
	const lines = [`Curated source pool: ${pool.entries.length} articles, built ${ageDays} day(s) ago`];
	for (const [list, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`- ${list}: ${n}`);
	}
	return lines.join("\n");
}

export default function openColliderExtension(pi: ExtensionAPI) {
	let active: ActiveCollision | null = null;
	let last: { question: string; mode: Mode; distance: Distance } | null = null;

	async function startCollision(question: string, mode: Mode, distance: Distance, ctx: any): Promise<void> {
		const count = mode === "deep" ? 2 : 3;

		// Phase 0: tag the question with abstract structural primitives via an
		// out-of-band LLM call, then condition the pool draw on them. The main
		// conversation never sees this, so Phase A blindness is preserved.
		let effective = distance;
		let primitives: string[] | null = null;
		if (effective !== "far") {
			ctx.ui.setStatus("open-collider", "phase 0: tagging structure");
			primitives = await tagQuestion(question, ctx);
			if (!primitives) {
				ctx.ui.notify("Structural tagging unavailable (no model/key or unparseable output); drawing unconditioned.", "warning");
				effective = "far";
			} else {
				ctx.ui.notify(`Question structure: ${primitives.join(", ")}`, "info");
			}
		}

		const wildcardSlots = effective === "near" ? 0 : WILDCARD_SLOTS;
		const curated = count - wildcardSlots;
		ctx.ui.setStatus("open-collider", "drawing");
		const how = effective === "far" ? "random" : "structure-matched";
		ctx.ui.notify(
			`Drawing ${count} sources (${curated} ${how}${wildcardSlots ? ` + ${wildcardSlots} wildcard` : ""}, distance: ${effective})...`,
			"info",
		);

		const { sources, error } = await drawSources({
			count,
			wildcardSlots,
			primitives: effective === "far" ? null : primitives,
			exclude: recentTitles(ctx.cwd),
			ctx,
			onPoolBuild: () =>
				ctx.ui.notify("Building curated source pool from seed lists (first run, ~10-20s)...", "info"),
		});
		if (sources.length < count) {
			ctx.ui.setStatus("open-collider", "idle");
			const reason = error ? ` Last error: ${error}` : " All candidates were stubs; try again.";
			ctx.ui.notify(`Could only draw ${sources.length}/${count} usable sources.${reason}`, "warning");
			return;
		}

		active = { question, mode, phase: "A", sources, distance: effective, primitives };
		last = { question, mode, distance };
		ctx.ui.notify(
			`Drew: ${sources.map((s) => (s.origin === "wildcard" ? `${s.title} (wildcard)` : s.title)).join(" + ")}`,
			"info",
		);
		ctx.ui.setStatus("open-collider", "phase A: blind extraction");
		pi.sendUserMessage(phaseAPrompt(sources, mode));
	}

	pi.on("session_start", async (_event, ctx) => {
		ensureLogFile(ctx.cwd);
		ctx.ui.setStatus("open-collider", "idle");
		ctx.ui.notify("Open Collider ready: /collide <question> for a random-source collision.", "info");
	});

	pi.on("message_end", async (event, ctx) => {
		if (!active) return;
		if (event.message?.role !== "assistant") return;
		if (!textFromMessage(event.message).trim()) return;

		if (active.phase === "A") {
			active.phase = "B";
			ctx.ui.setStatus("open-collider", "phase B: collision");
			pi.sendUserMessage(phaseBPrompt(active.question, active.mode), { deliverAs: "followUp" });
			return;
		}

		appendLog(ctx.cwd, {
			timestamp: Date.now(),
			mode: active.mode,
			question: active.question,
			sources: active.sources.map((s) => ({ title: s.title, url: s.url, origin: s.origin })),
			verdict: null,
			distance: active.distance,
			primitives: active.primitives ?? undefined,
		});
		active = null;
		ctx.ui.setStatus("open-collider", "idle");
		ctx.ui.notify("Collision complete. /collision-rate <verdict> to rate it, /reroll to redraw.", "info");
	});

	async function resolveQuestion(args: string, ctx: any): Promise<string | null> {
		const fromArgs = args.trim();
		if (fromArgs) return fromArgs;
		if (!ctx.hasUI) return null;
		const answer = await ctx.ui.input(
			"What question or problem should the collision target?",
			"Describe the idea space, problem, or decision...",
		);
		return answer?.trim() || null;
	}

	pi.registerCommand("collide", {
		description:
			"Collide a question with structure-matched external sources: /collide [--distance near|mid|far] <question>",
		handler: async (args, ctx) => {
			const { question: fromArgs, distance } = parseCollideArgs(args);
			const question = await resolveQuestion(fromArgs, ctx);
			if (!question) {
				ctx.ui.notify("Usage: /collide [--distance near|mid|far] <question or problem>", "warning");
				return;
			}
			await startCollision(question, "standard", distance ?? "mid", ctx);
		},
	});

	pi.registerCommand("collide-deep", {
		description:
			"Two-source intersection collision (weirder, noisier): /collide-deep [--distance near|mid|far] <question>",
		handler: async (args, ctx) => {
			const { question: fromArgs, distance } = parseCollideArgs(args);
			const question = await resolveQuestion(fromArgs, ctx);
			if (!question) {
				ctx.ui.notify("Usage: /collide-deep [--distance near|mid|far] <question or problem>", "warning");
				return;
			}
			await startCollision(question, "deep", distance ?? "mid", ctx);
		},
	});

	pi.registerCommand("reroll", {
		description: "Redraw fresh sources for the most recent collision question: /reroll [--distance near|mid|far]",
		handler: async (args, ctx) => {
			if (!last) {
				ctx.ui.notify("Nothing to reroll yet. Run /collide <question> first.", "warning");
				return;
			}
			const { distance } = parseCollideArgs(args);
			await startCollision(last.question, last.mode, distance ?? last.distance, ctx);
		},
	});

	pi.registerCommand("collision-rate", {
		description: "Rate the most recent collision: /collision-rate <fertile|dead|any short verdict>",
		handler: async (args, ctx) => {
			const verdict = args.trim();
			if (!verdict) {
				ctx.ui.notify("Usage: /collision-rate <fertile|dead|any short verdict>", "warning");
				return;
			}
			const rated = rateLastEntry(ctx.cwd, verdict);
			if (!rated) {
				ctx.ui.notify("No collisions logged yet.", "warning");
				return;
			}
			ctx.ui.notify(`Rated "${rated.sources.map((s) => s.title).join(" + ")}" as: ${verdict}`, "info");
		},
	});

	pi.registerCommand("collision-log", {
		description: "Show the collision draw log",
		handler: async (_args, ctx) => {
			pi.sendMessage(
				{ customType: "open-collider-log", content: summarizeLog(loadLog(ctx.cwd)), display: true },
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
			ctx.ui.notify("Collision log added to transcript.", "info");
		},
	});

	pi.registerCommand("collider-pool", {
		description: "Show the curated source pool stats; /collider-pool rebuild to refresh it",
		handler: async (args, ctx) => {
			if (args.trim().toLowerCase() === "rebuild") {
				ctx.ui.setStatus("open-collider", "building pool");
				ctx.ui.notify("Rebuilding curated source pool from seed lists...", "info");
				const pool = await buildPool(ctx.cwd);
				ctx.ui.setStatus("open-collider", "idle");
				ctx.ui.notify(`Pool rebuilt: ${pool.entries.length} articles from ${SEED_LISTS.length} seed lists.`, "info");
				return;
			}
			pi.sendMessage(
				{
					customType: "open-collider-pool",
					content: summarizePool(readCachedPool(ctx.cwd, true)),
					display: true,
				},
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
			ctx.ui.notify("Pool stats added to transcript.", "info");
		},
	});
}
