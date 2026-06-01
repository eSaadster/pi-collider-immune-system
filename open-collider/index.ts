import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type AskQuestionDetails = {
	question: string;
	reason?: string;
	answer: string | null;
};

const OPEN_COLLIDER_METHOD = String.raw`
You are running inside an Open Collider project extension.

Open Collider exists to escape AI slop: do not move directly from the user's repo/request to obvious ideas. Before proposing product ideas, architecture changes, feature concepts, refactors, UX directions, research plans, or implementation strategies, force a collision with a structurally distant domain.

Required method for creative/build suggestions:
1. Restate the local problem in structural terms, not surface terms. Identify the actual forces, constraints, incentives, failure modes, bottlenecks, feedback loops, or asymmetries in this repo/request.
2. Choose at least one structurally distant domain that is not software/product/startups unless the user explicitly asks for those. Good domains include biology, materials science, ecology, ritual systems, logistics, cryptography, architecture, medicine, aviation, game theory, music theory, geology, maritime practice, jurisprudence, fermentation, epidemiology, theater, etc.
3. Extract a counter-intuitive active principle from that domain. It must be a causal mechanism, not a decorative metaphor. Examples: "fragile tail controls the strong head", "slow invisible inoculation transforms the substrate", "negative space carries the load", "triangulate through provenance instead of appearance".
4. Map the mechanism onto the repo/request. Name what corresponds to what. If the mapping is fake, discard it and pick another domain.
5. Generate ideas that could not exist without that collision. Each proposal must carry operational consequences for this repository: files/components to change, behavior to add/remove, or a concrete experiment to run.
6. Kill generic advice. If removing the distant-domain principle leaves the idea unchanged, it is AI slop and must not be presented as a collision.

Use the ask_question tool whenever missing context would materially change the collision space, the scoring criteria, or the next action. Prefer asking 1-3 high-leverage questions over guessing. Ask questions that expose constraints, taste, audience, unacceptable directions, or what would count as a useful weird idea.

Default output shape when ideating:
- Collision domain + active principle
- Structural mapping to this repo/request
- Collision-born ideas, each with: proposal, why it could not arise from direct prompting, concrete repo action, strongest objection
- Questions for the user, preferably via ask_question when an answer is needed before proceeding
`;

export default function openColliderExtension(pi: ExtensionAPI) {
	let enabled = true;

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("open-collider", enabled ? "collision:on" : "collision:off");
		ctx.ui.notify("Open Collider extension active: distant-domain collision before ideas.", "info");
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${OPEN_COLLIDER_METHOD}`,
		};
	});

	pi.registerTool({
		name: "ask_question",
		label: "Ask Question",
		description:
			"Ask the user one high-leverage Open Collider clarification question before generating ideas. Use when the answer would change the collision domain, constraints, scoring criteria, or next repo action.",
		promptSnippet: "Ask the user a high-leverage clarification question and wait for the answer.",
		promptGuidelines: [
			"Use ask_question before Open Collider ideation when user constraints, audience, desired weirdness, or success criteria are unclear.",
			"Use ask_question for 1-3 high-leverage questions, not long surveys.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The concise question to ask the user." }),
			reason: Type.Optional(Type.String({ description: "Why this answer matters for the collision." })),
			placeholder: Type.Optional(Type.String({ description: "Optional placeholder text for the answer input." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: `Question not asked because UI is unavailable: ${params.question}` }],
					details: { question: params.question, reason: params.reason, answer: null } as AskQuestionDetails,
					isError: true,
				};
			}

			const title = params.reason ? `${params.question}\n\nWhy: ${params.reason}` : params.question;
			const answer = await ctx.ui.input(title, params.placeholder ?? "Type your answer...");
			const trimmed = answer?.trim() || null;

			return {
				content: [
					{
						type: "text",
						text: trimmed ? `User answered: ${trimmed}` : "User did not provide an answer.",
					},
				],
				details: { question: params.question, reason: params.reason, answer: trimmed } as AskQuestionDetails,
			};
		},
	});

	pi.registerCommand("open-collider", {
		description: "Show the Open Collider method enforced by this project extension",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Open Collider: structural distant-domain collision before ideation.", "info");
			pi.sendMessage(
				{
					customType: "open-collider-method",
					content: OPEN_COLLIDER_METHOD.trim(),
					display: true,
				},
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
		},
	});

	pi.registerCommand("open-collider-mode", {
		description: "Turn Open Collider prompt injection on/off/status: /open-collider-mode on|off|status",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else if (arg && arg !== "status") {
				ctx.ui.notify("Usage: /open-collider-mode on|off|status", "warning");
				return;
			}

			ctx.ui.setStatus("open-collider", enabled ? "collision:on" : "collision:off");
			ctx.ui.notify(`Open Collider prompt injection is ${enabled ? "ON" : "OFF"}.`, "info");
		},
	});
}
