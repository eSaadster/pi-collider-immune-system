import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RANDOM_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const MIN_EXTRACT_CHARS = 350;
const FETCH_BATCH_SIZE = 6;
const MAX_FETCH_BATCHES = 6;
const RECENT_LOG_WINDOW = 40;

type Mode = "standard" | "deep";

type Source = {
	title: string;
	description: string;
	extract: string;
	url: string;
};

type LogEntry = {
	timestamp: number;
	mode: Mode;
	question: string;
	sources: { title: string; url: string }[];
	verdict: string | null;
};

type ActiveCollision = {
	question: string;
	mode: Mode;
	phase: "A" | "B";
	sources: Source[];
};

function logPath(cwd: string): string {
	return join(cwd, ".pi", "open-collider", "collisions.jsonl");
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

async function fetchRandomSource(): Promise<Source | null> {
	const res = await fetch(RANDOM_SUMMARY_URL, { headers: { accept: "application/json" } });
	if (!res.ok) return null;
	const data: any = await res.json();
	if (data?.type !== "standard") return null;
	const extract = typeof data?.extract === "string" ? data.extract.trim() : "";
	if (extract.length < MIN_EXTRACT_CHARS) return null;
	return {
		title: String(data.title ?? "Untitled"),
		description: typeof data.description === "string" ? data.description : "",
		extract,
		url: String(data?.content_urls?.desktop?.page ?? ""),
	};
}

async function drawSources(count: number, exclude: Set<string>): Promise<Source[]> {
	const sources: Source[] = [];
	const seen = new Set<string>();
	for (let batch = 0; batch < MAX_FETCH_BATCHES && sources.length < count; batch++) {
		const results = await Promise.all(
			Array.from({ length: FETCH_BATCH_SIZE }, () => fetchRandomSource().catch(() => null)),
		);
		for (const source of results) {
			if (!source || sources.length >= count) continue;
			const key = source.title.toLowerCase();
			if (seen.has(key) || exclude.has(key)) continue;
			seen.add(key);
			sources.push(source);
		}
	}
	return sources;
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
		lines.push(`- [${date}] (${entry.mode}) "${entry.question}" × ${titles}${verdict}`);
	}
	return lines.join("\n");
}

export default function openColliderExtension(pi: ExtensionAPI) {
	let active: ActiveCollision | null = null;
	let last: { question: string; mode: Mode } | null = null;

	async function startCollision(question: string, mode: Mode, ctx: any): Promise<void> {
		const count = mode === "deep" ? 2 : 3;
		ctx.ui.setStatus("open-collider", "drawing");
		ctx.ui.notify(`Drawing ${count} random sources...`, "info");

		const sources = await drawSources(count, recentTitles(ctx.cwd));
		if (sources.length < count) {
			ctx.ui.setStatus("open-collider", "idle");
			ctx.ui.notify(
				`Could only draw ${sources.length}/${count} usable sources (network or stub filtering). Try again.`,
				"warning",
			);
			return;
		}

		active = { question, mode, phase: "A", sources };
		last = { question, mode };
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
			sources: active.sources.map((s) => ({ title: s.title, url: s.url })),
			verdict: null,
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
		description: "Collide a question with randomly drawn external sources: /collide <question>",
		handler: async (args, ctx) => {
			const question = await resolveQuestion(args, ctx);
			if (!question) {
				ctx.ui.notify("Usage: /collide <question or problem>", "warning");
				return;
			}
			await startCollision(question, "standard", ctx);
		},
	});

	pi.registerCommand("collide-deep", {
		description: "Two-source intersection collision (weirder, noisier): /collide-deep <question>",
		handler: async (args, ctx) => {
			const question = await resolveQuestion(args, ctx);
			if (!question) {
				ctx.ui.notify("Usage: /collide-deep <question or problem>", "warning");
				return;
			}
			await startCollision(question, "deep", ctx);
		},
	});

	pi.registerCommand("reroll", {
		description: "Redraw fresh sources for the most recent collision question",
		handler: async (_args, ctx) => {
			if (!last) {
				ctx.ui.notify("Nothing to reroll yet. Run /collide <question> first.", "warning");
				return;
			}
			await startCollision(last.question, last.mode, ctx);
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
}
