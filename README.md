<p align="center">
  <img src="assets/collider-immune-system-hero.png" alt="Collider Immune System hero banner" width="100%">
</p>

# Collider Immune System

A local pi extension suite that forces distant-domain collisions, quarantines generic AI slop, and remembers fertile principles for better repo-specific ideas.

Built for builders who can implement once the shape is visible, but need help pushing LLM ideation past the generic shallows toward weird-edge ideas worth building.

## Credit

This package is based on the method and conceptual architecture of the original **Open Collider** project:

- Repository: <https://github.com/CL-ML/open-collider>
- Author: Cédric Lion / Oparine

Open Collider's core idea is that useful originality comes from forcing an LLM to reason through a counter-intuitive causal principle from a structurally distant domain before generating ideas. This local pi extension suite adapts that method into always-available project extensions.

## What you get

Collider Immune System has three independent pi extensions:

| Layer | Extension | Role |
|---|---|---|
| Method | `open-collider` | injects the collision reasoning contract |
| Quarantine | `collision-quarantine` | catches and corrects generic ideation |
| Memory | `collision-mycelium` | remembers fertile and dead collision paths |

Use one extension by itself, or install all three as a layered system.

## Installation

### Option A — Install all three as a project-local extension suite

From the root of any pi project:

```bash
mkdir -p .pi/extensions
git clone https://github.com/eSaadster/pi-collider-immune-system /tmp/pi-collider-immune-system
cp -R /tmp/pi-collider-immune-system/open-collider .pi/extensions/
cp -R /tmp/pi-collider-immune-system/collision-quarantine .pi/extensions/
cp -R /tmp/pi-collider-immune-system/collision-mycelium .pi/extensions/
```

Then restart pi or run:

```text
/reload
```

### Option B — Install only one extension

Clone the package somewhere temporary:

```bash
git clone https://github.com/eSaadster/pi-collider-immune-system /tmp/pi-collider-immune-system
```

Then copy only the extension you want:

```bash
# Method layer only
mkdir -p .pi/extensions
cp -R /tmp/pi-collider-immune-system/open-collider .pi/extensions/

# OR quarantine layer only
cp -R /tmp/pi-collider-immune-system/collision-quarantine .pi/extensions/

# OR memory layer only
cp -R /tmp/pi-collider-immune-system/collision-mycelium .pi/extensions/
```

Reload pi:

```text
/reload
```

### Option C — Install globally for all pi projects

Copy extensions into your global pi extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/eSaadster/pi-collider-immune-system /tmp/pi-collider-immune-system
cp -R /tmp/pi-collider-immune-system/open-collider ~/.pi/agent/extensions/
cp -R /tmp/pi-collider-immune-system/collision-quarantine ~/.pi/agent/extensions/
cp -R /tmp/pi-collider-immune-system/collision-mycelium ~/.pi/agent/extensions/
```

Then restart pi or run `/reload` inside an active session.

## Using the extensions separately

### 1. `open-collider/` — method layer

Use this when you want pi to follow the Open Collider reasoning method, without enforcement or memory.

It adds the Open Collider contract to pi's system prompt. Before proposing product ideas, architecture changes, feature concepts, refactors, UX directions, research plans, or implementation strategies, pi should:

1. restate the local problem structurally,
2. choose a structurally distant domain,
3. extract a counter-intuitive active principle,
4. map that mechanism back to the repo/request,
5. generate ideas with concrete repo actions,
6. reject decorative metaphors and generic advice.

It also provides an `ask_question` tool for high-leverage clarification questions.

Commands:

```text
/open-collider
/open-collider-mode on|off|status
```

Example:

```text
/open-collider-mode on
What weird feature should we build in this repo?
```

Turn it off for the current session:

```text
/open-collider-mode off
```

### 2. `collision-quarantine/` — enforcement layer

Use this when you want pi to audit ideation answers and regenerate if they skip the collision structure.

It detects ideation/build/refactor/design prompts and checks final assistant answers for:

- structural problem framing
- distant collision domain
- active causal principle
- explicit mapping
- concrete repo action
- strongest objection

If an answer is missing required pieces, it sends a follow-up regeneration request with the missing elements.

Commands:

```text
/collider-strict on|off|status
```

Example:

```text
/collider-strict on
Suggest a surprising architecture change for this project.
```

Turn it off for the current session:

```text
/collider-strict off
```

> You can use quarantine by itself, but it works best with `open-collider`, because quarantine enforces the structure that `open-collider` teaches.

### 3. `collision-mycelium/` — memory layer

Use this when you want pi to remember which collision domains and active principles helped or failed.

It persists memory in:

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

Examples:

```text
/collision-love epidemiology: interrupt transmission at contact events
/collision-like fermentation: slow invisible inoculation transforms the substrate
/collision-trash generic architecture metaphors
/collision-memory
```

Turn memory injection off for the current session:

```text
/collision-mycelium off
```

Turn automatic extraction of unrated “spores” from assistant answers off:

```text
/collision-mycelium spores-off
```

Clear memory:

```text
/collision-clear-memory
```

## Using all three together

Install all three extensions, reload pi, then use this default workflow:

```text
/open-collider-mode on
/collider-strict on
/collision-mycelium on
```

Ask for repo-specific ideas:

```text
What weird feature should we build in this repo?
```

Pi should:

1. ask a clarification question if the collision target is unclear,
2. reason through a structurally distant domain,
3. produce ideas that depend on the transferred causal mechanism,
4. attach concrete repo actions,
5. include strongest objections,
6. get corrected by quarantine if it slips into generic suggestions,
7. store/expose collision principles you can later mark as loved, liked, or trashed.

After a useful answer, mark what worked:

```text
/collision-love mycology: hidden routing substrate remembers fertile paths
```

After a weak answer, mark what to avoid:

```text
/collision-trash decorative maritime metaphors
```

View memory:

```text
/collision-memory
```

Disable all three layers for the current session:

```text
/open-collider-mode off
/collider-strict off
/collision-mycelium off
```

> Note: toggles are currently in-memory. After restarting pi or reloading extensions, defaults return to enabled.

## Recommended combinations

### Lightweight mode

Use only:

```text
open-collider
```

Best when you want softer guidance and do not want automatic correction.

### Strict anti-slop mode

Use:

```text
open-collider
collision-quarantine
```

Best when you want ideation answers to obey the Open Collider output contract.

### Adaptive ideation mode

Use:

```text
open-collider
collision-mycelium
```

Best when you want the system to learn which collision mechanisms fit your taste over time.

### Full Collider Immune System

Use:

```text
open-collider
collision-quarantine
collision-mycelium
```

Best when you want method + enforcement + memory.

## Example session

```text
/reload

What weird feature should we build in this repo?

# After reading the answer:
/collision-love prosthetics: externalize one missing motion so the rest of the body can act naturally
/collision-trash generic productivity advice

# Later:
What is a non-obvious UX direction for this project?
```

## Updating

To update a project-local install:

```bash
git clone https://github.com/eSaadster/pi-collider-immune-system /tmp/pi-collider-immune-system
cp -R /tmp/pi-collider-immune-system/open-collider .pi/extensions/
cp -R /tmp/pi-collider-immune-system/collision-quarantine .pi/extensions/
cp -R /tmp/pi-collider-immune-system/collision-mycelium .pi/extensions/
```

Then run:

```text
/reload
```

## Uninstalling

Remove the extension directories you no longer want:

```bash
rm -rf .pi/extensions/open-collider
rm -rf .pi/extensions/collision-quarantine
rm -rf .pi/extensions/collision-mycelium
```

Optional: remove local mycelium memory:

```bash
rm -rf .pi/open-collider
```

Then reload pi:

```text
/reload
```

## Package model

Together, the three extensions adapt Open Collider from a standalone brainstorming architecture into local pi project behavior.

Pi should not merely “be creative.” It should route creative/build suggestions through transferable mechanisms from distant domains, reject fake collisions, and learn from user feedback.
