<p align="center">
  <img src="assets/collider-immune-system-hero.png" alt="Collider Immune System hero banner" width="100%">
</p>

# Collider Immune System

A local pi extension suite that forces distant-domain collisions, quarantines generic AI slop, and remembers fertile principles for better repo-specific ideas.

## Credit

This package is based on the method and conceptual architecture of the original **Open Collider** project:

- Repository: <https://github.com/CL-ML/open-collider>
- Author: Cédric Lion / Oparine

Open Collider's core idea is that useful originality comes from forcing an LLM to reason through a counter-intuitive causal principle from a structurally distant domain before generating ideas. This local pi extension suite adapts that method into always-available project extensions.

## Extensions

### 1. `open-collider/`

The method layer.

Adds the Open Collider reasoning contract to pi's system prompt before agent turns. It instructs pi to avoid direct generic ideation and instead:

1. restate the local problem structurally,
2. choose a structurally distant domain,
3. extract a counter-intuitive active principle,
4. map that mechanism back to the repo/request,
5. generate ideas with concrete repo actions,
6. reject decorative metaphors and generic advice.

Also provides an `ask_question` tool for high-leverage clarification questions.

Commands:

```text
/open-collider
/open-collider-mode on|off|status
```

### 2. `collision-quarantine/`

The enforcement layer.

Detects ideation/build/refactor/design prompts and audits assistant answers for real Open Collider structure. If an answer is missing required pieces, it asks pi to regenerate with the missing elements.

Checks for:

- structural problem framing
- distant collision domain
- active causal principle
- explicit mapping
- concrete repo action
- strongest objection

Commands:

```text
/collider-strict on|off|status
```

### 3. `collision-mycelium/`

The memory layer.

Persists useful collision domains and active principles across turns, so future ideation can deepen or refresh what has worked before while still requiring at least one fresh distant domain.

Stores memory in:

```text
.pi/open-collider/collision-memory.jsonl
```

Commands:

```text
/collision-love <domain or active principle>
/collision-like <domain or active principle>
/collision-trash <domain or active principle>
/collision-memory
/collision-clear-memory
/collision-mycelium on|off|spores-on|spores-off|status
```

## Usage

Reload pi extensions after changes:

```text
/reload
```

Ask for repo-specific ideas:

```text
What weird feature should we build in this repo?
```

Mark useful or weak collision paths:

```text
/collision-love epidemiology: interrupt transmission at contact events
/collision-trash generic architecture metaphors
```

Disable all three layers for the current session:

```text
/open-collider-mode off
/collider-strict off
/collision-mycelium off
```

> Note: toggles are currently in-memory. After restarting pi or reloading extensions, defaults return to enabled.

## Package model

The three extensions work as a layered system:

| Layer | Extension | Role |
|---|---|---|
| Method | `open-collider` | injects the collision reasoning contract |
| Quarantine | `collision-quarantine` | catches and corrects generic ideation |
| Memory | `collision-mycelium` | remembers fertile and dead collision paths |

Together they adapt Open Collider from a standalone brainstorming architecture into a local pi project behavior: pi should not merely “be creative”; it should route creative/build suggestions through transferable mechanisms from distant domains, reject fake collisions, and learn from user feedback.
