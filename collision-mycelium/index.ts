import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type MemoryKind = "love" | "like" | "trash" | "spore";

type MemoryEntry = {
	kind: MemoryKind;
	text: string;
	timestamp: number;
	source: "user-command" | "assistant-extract";
};

const MAX_INJECTED_PER_KIND = 8;

function memoryPath(cwd: string): string {
	return join(cwd, ".pi", "open-collider", "collision-memory.jsonl");
}

function ensureMemoryFile(cwd: string): string {
	const file = memoryPath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	if (!existsSync(file)) writeFileSync(file, "", "utf8");
	return file;
}

function appendMemory(cwd: string, entry: MemoryEntry): void {
	const file = ensureMemoryFile(cwd);
	appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

function loadMemory(cwd: string): MemoryEntry[] {
	const file = ensureMemoryFile(cwd);
	const raw = readFileSync(file, "utf8");
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = JSON.parse(line) as MemoryEntry;
				if (!parsed.kind || !parsed.text) return [];
				return [parsed];
			} catch {
				return [];
			}
		});
}

function clearMemory(cwd: string): void {
	const file = ensureMemoryFile(cwd);
	writeFileSync(file, "", "utf8");
}

function newestUnique(entries: MemoryEntry[], kind: MemoryKind, limit = MAX_INJECTED_PER_KIND): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of [...entries].reverse()) {
		if (entry.kind !== kind) continue;
		const key = entry.text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(entry.text);
		if (out.length >= limit) break;
	}
	return out;
}

function formatMemoryForPrompt(entries: MemoryEntry[]): string {
	const loved = newestUnique(entries, "love");
	const liked = newestUnique(entries, "like");
	const trashed = newestUnique(entries, "trash");
	const spores = newestUnique(entries, "spore", 5);

	if (loved.length + liked.length + trashed.length + spores.length === 0) return "";

	const lines = [
		"Collision Mycelium memory is active.",
		"Use this as routing memory, not as a cage: preserve at least one fresh structurally distant domain per ideation answer.",
	];
	if (loved.length) lines.push("\nFertile loved principles/domains:", ...loved.map((x) => `- ${x}`));
	if (liked.length) lines.push("\nPromising liked principles/domains:", ...liked.map((x) => `- ${x}`));
	if (spores.length) lines.push("\nUnrated extracted spores from prior answers:", ...spores.map((x) => `- ${x}`));
	if (trashed.length) lines.push("\nAvoid these dead/decorative paths unless the user explicitly asks:", ...trashed.map((x) => `- ${x}`));
	lines.push(
		"\nWhen proposing ideas, prefer mechanisms structurally adjacent to fertile memory, but do not merely repeat the same domain. Refresh or deepen the active causal principle.",
	);
	return lines.join("\n");
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

function extractSpores(text: string): string[] {
	const spores = new Set<string>();
	const domainMatch = text.match(/(?:collision domain|domain)\s*:?\s*\*?\*?([^\n]+)/i);
	const principleMatch = text.match(/(?:active principle|causal principle|counter-intuitive[^\n]*principle)\s*:?\s*\*?\*?([^\n]+)/i);
	if (domainMatch?.[1]) spores.add(`domain: ${domainMatch[1].replace(/[*`]/g, "").trim()}`);
	if (principleMatch?.[1]) spores.add(`principle: ${principleMatch[1].replace(/[*`]/g, "").trim()}`);
	return [...spores].filter((s) => s.length > 10 && s.length < 240);
}

function summarize(entries: MemoryEntry[]): string {
	if (entries.length === 0) return "Collision Mycelium memory is empty.";
	const groups: MemoryKind[] = ["love", "like", "trash", "spore"];
	const lines = [`Collision Mycelium memory: ${entries.length} entries`];
	for (const kind of groups) {
		const items = newestUnique(entries, kind, 20);
		if (!items.length) continue;
		lines.push(`\n${kind.toUpperCase()}`);
		items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
	}
	return lines.join("\n");
}

export default function collisionMycelium(pi: ExtensionAPI) {
	let enabled = true;
	let autoExtractSpores = true;

	pi.on("session_start", async (_event, ctx) => {
		ensureMemoryFile(ctx.cwd);
		ctx.ui.setStatus("collision-mycelium", enabled ? "mycelium:on" : "mycelium:off");
		ctx.ui.notify("Collision Mycelium active: user-rated collision principles persist across turns.", "info");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return;
		const memory = formatMemoryForPrompt(loadMemory(ctx.cwd));
		if (!memory) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${memory}` };
	});

	pi.on("message_end", async (event, ctx) => {
		if (!enabled || !autoExtractSpores) return;
		if (event.message?.role !== "assistant") return;
		const spores = extractSpores(textFromMessage(event.message));
		for (const spore of spores) {
			appendMemory(ctx.cwd, { kind: "spore", text: spore, timestamp: Date.now(), source: "assistant-extract" });
		}
	});

	function registerMarkCommand(name: string, kind: MemoryKind, description: string) {
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				const text = args.trim();
				if (!text) {
					ctx.ui.notify(`Usage: /${name} <domain or active principle>`, "warning");
					return;
				}
				appendMemory(ctx.cwd, { kind, text, timestamp: Date.now(), source: "user-command" });
				ctx.ui.notify(`Recorded ${kind}: ${text}`, kind === "trash" ? "warning" : "info");
			},
		});
	}

	registerMarkCommand("collision-love", "love", "Mark a collision domain/principle as fertile for future ideation");
	registerMarkCommand("collision-like", "like", "Mark a collision domain/principle as promising for future ideation");
	registerMarkCommand("collision-trash", "trash", "Mark a collision domain/principle as dead/decorative to avoid");

	pi.registerCommand("collision-memory", {
		description: "Show Collision Mycelium memory",
		handler: async (_args, ctx) => {
			pi.sendMessage(
				{ customType: "collision-mycelium-memory", content: summarize(loadMemory(ctx.cwd)), display: true },
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
			ctx.ui.notify("Collision memory added to transcript.", "info");
		},
	});

	pi.registerCommand("collision-clear-memory", {
		description: "Clear all Collision Mycelium memory",
		handler: async (_args, ctx) => {
			const ok = await ctx.ui.confirm("Clear Collision Mycelium memory?", "This deletes .pi/open-collider/collision-memory.jsonl contents.");
			if (!ok) return;
			clearMemory(ctx.cwd);
			ctx.ui.notify("Collision Mycelium memory cleared.", "warning");
		},
	});

	pi.registerCommand("collision-mycelium", {
		description: "Control Collision Mycelium: /collision-mycelium on|off|spores-on|spores-off|status",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else if (arg === "spores-on") autoExtractSpores = true;
			else if (arg === "spores-off") autoExtractSpores = false;
			else if (arg && arg !== "status") {
				ctx.ui.notify("Usage: /collision-mycelium on|off|spores-on|spores-off|status", "warning");
				return;
			}
			ctx.ui.setStatus("collision-mycelium", enabled ? "mycelium:on" : "mycelium:off");
			ctx.ui.notify(`Collision Mycelium ${enabled ? "ON" : "OFF"}; spore extraction ${autoExtractSpores ? "ON" : "OFF"}.`, "info");
		},
	});
}
