import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const IDEATION_RE = /\b(idea|ideas|feature|features|weird|build|propose|proposal|suggest|suggestion|brainstorm|architecture|architectural|refactor|strategy|ux|product|improve|improvement|design|plan|roadmap|experiment)\b/i;
const QUESTION_RE = /\?\s*$/;

const REQUIRED_MARKERS = [
	{
		id: "structural problem",
		patterns: [/structural/i, /forces?/i, /constraints?/i, /failure modes?/i, /bottlenecks?/i, /asymmetr/i],
	},
	{
		id: "distant collision domain",
		patterns: [/collision domain/i, /domain:/i, /biology|ecology|medicine|aviation|jurisprudence|fermentation|epidemiology|materials science|architecture|logistics|cryptography|theater|music theory|geology|maritime|ritual/i],
	},
	{
		id: "active causal principle",
		patterns: [/active principle/i, /causal mechanism/i, /counter-?intuitive/i, /principle:/i],
	},
	{
		id: "explicit mapping",
		patterns: [/mapping/i, /maps? onto/i, /corresponds? to/i, /structural mapping/i],
	},
	{
		id: "concrete repo action",
		patterns: [/concrete repo action/i, /repo action/i, /files?\/components? to change/i, /\.pi\/extensions|src\/|tests\/|README|file/i],
	},
	{
		id: "strongest objection",
		patterns: [/strongest objection/i, /objection:/i, /challenge:/i, /risk:/i],
	},
];

const STRICT_PROMPT = `
Collision Quarantine is active.

For this user request, do not answer with direct generic suggestions. If missing context would materially change the collision space or scoring criteria, call ask_question before proposing ideas.

If you do propose ideas, your final answer must include:
- structural restatement of the local problem
- structurally distant collision domain
- counter-intuitive active causal principle
- explicit mapping from domain mechanism to repo/request
- collision-born proposal(s) with concrete repo actions
- strongest objection for each proposal

Generic advice with a domain name sprinkled on top fails quarantine.
`;

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

function isIdeationPrompt(text: string): boolean {
	const normalized = text.trim();
	if (!normalized) return false;
	return IDEATION_RE.test(normalized) || (QUESTION_RE.test(normalized) && /\b(should|could|would|how)\b/i.test(normalized));
}

function auditCollisionAnswer(text: string): string[] {
	const missing: string[] = [];
	for (const marker of REQUIRED_MARKERS) {
		if (!marker.patterns.some((pattern) => pattern.test(text))) {
			missing.push(marker.id);
		}
	}
	return missing;
}

export default function collisionQuarantine(pi: ExtensionAPI) {
	let strict = true;
	let ideationRiskTurn = false;
	let correcting = false;
	let lastCorrectionAt = 0;

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("collision-quarantine", strict ? "quarantine:on" : "quarantine:off");
		ctx.ui.notify("Collision Quarantine active: ideation answers are audited for real Open Collider structure.", "info");
	});

	pi.on("input", async (event, ctx) => {
		if (!strict) return { action: "continue" as const };
		if (event.source === "extension") return { action: "continue" as const };

		ideationRiskTurn = isIdeationPrompt(event.text);
		if (ideationRiskTurn) {
			ctx.ui.setStatus("collision-quarantine", "ideation-risk");
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event) => {
		if (!strict || !ideationRiskTurn) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${STRICT_PROMPT}` };
	});

	pi.on("message_end", async (event, ctx) => {
		if (!strict || !ideationRiskTurn || correcting) return;
		if (event.message?.role !== "assistant") return;

		const text = textFromMessage(event.message);
		if (!text.trim()) return;

		const missing = auditCollisionAnswer(text);
		if (missing.length === 0) {
			ctx.ui.setStatus("collision-quarantine", "passed");
			ideationRiskTurn = false;
			return;
		}

		const now = Date.now();
		if (now - lastCorrectionAt < 10_000) return;
		lastCorrectionAt = now;
		correcting = true;
		ctx.ui.setStatus("collision-quarantine", "quarantined");
		ctx.ui.notify(`Collision Quarantine blocked generic ideation. Missing: ${missing.join(", ")}`, "warning");

		pi.sendUserMessage(
			`Regenerate your previous answer. Collision Quarantine failed it because it was missing: ${missing.join(", ")}.

Do not apologize. Produce a compliant Open Collider answer with:
1. structural restatement of the local problem,
2. distant non-software domain,
3. counter-intuitive active causal principle,
4. explicit mapping,
5. collision-born proposal(s) with concrete repo file/component actions,
6. strongest objection for each proposal.

If the missing information would change the answer materially, call ask_question instead of guessing.`,
			{ deliverAs: "followUp" },
		);

		setTimeout(() => {
			correcting = false;
		}, 1_000);
	});

	pi.registerCommand("collider-strict", {
		description: "Turn Collision Quarantine on/off/status: /collider-strict on|off|status",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") strict = true;
			else if (arg === "off") strict = false;
			else if (arg && arg !== "status") {
				ctx.ui.notify("Usage: /collider-strict on|off|status", "warning");
				return;
			}

			ctx.ui.setStatus("collision-quarantine", strict ? "quarantine:on" : "quarantine:off");
			ctx.ui.notify(`Collision Quarantine is ${strict ? "ON" : "OFF"}.`, "info");
		},
	});
}
