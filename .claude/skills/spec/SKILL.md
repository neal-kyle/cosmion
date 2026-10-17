---
name: spec
description: Write or revise a feature spec for Oriel, clarify it with the owner, and get it approved before any tests or code. Use when starting a new feature or a meaningful behavior change.
argument-hint: <feature name or short description>
---

# /spec: specify, clarify, approve

Feature: $ARGUMENTS

Stop after step 4. No tests or code in this skill.

## 1. Read first

- The parts of `ARCHITECTURE.md` and `DESIGN.md` this feature touches.
- `docs/openrouter-api.md` if it talks to OpenRouter.
- Existing specs in `specs/` that it depends on or overlaps with.

## 2. Draft

Copy `specs/_templates/spec.md` to `specs/<kebab-case-name>/spec.md` (or open the
existing spec if revising) and fill it in.

- Behavior, not implementation. Short: usually under a page.
- Every acceptance criterion must be checkable by a test or by looking at the app.
- Only edge cases that can realistically happen.
- Reference the docs instead of repeating them.
- Anything marked **(verify)** in `docs/openrouter-api.md` that this feature depends on
  must be resolved first (check the live API, or ask), not assumed.

## 3. Clarify

List every ambiguity as a numbered question with your recommended answer, e.g.
"3. If the app closes mid-generation, is the image lost? Recommended: it's saved when it
arrives, and appears next launch." Keep it to questions whose answers change behavior.

When the owner answers, record each answer in the spec's **Clarifications** section and
update the spec to match. Repeat until nothing important is open.

## 4. Approve

Show the owner a short summary of the spec and ask for approval. On approval, set
**Status: Approved**. If the spec changed a settled decision in `ARCHITECTURE.md` or
`DESIGN.md`, update that doc too (and the decision log).

Next step: `/plan <feature>`.
