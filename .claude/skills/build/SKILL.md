---
name: build
description: Build one phase of an approved Oriel plan test-first, then converge the spec, plan, docs and code so they agree. Use only when the owner asks to build.
argument-hint: <feature name> [phase number]
disable-model-invocation: true
---

# /build: one phase, test-first, then converge

Feature and phase: $ARGUMENTS (in `specs/<feature>/`). If no phase is given, build the
next unfinished one.

## 1. Check

- `spec.md` must be **Approved** and `plan.md` **Approved** or **In progress**. If not,
  stop and suggest `/spec` or `/plan`.
- Re-read the spec, its Clarifications, the plan, and the doc sections they reference.
- Set the plan to **In progress**.

## 2. Build the phase, test-first

Work through the phase's tasks in order. For each:

1. Write the test for the acceptance criteria the task covers. Run it and show it fails.
2. Write the simplest code that makes it pass. Run it and show it passes.
3. Tidy up while the tests stay green.
4. Tick the task off in `plan.md`.

Apply TDD as `CLAUDE.md` describes (strictly in `core` and the CLI, behavior only in UI,
not for visual design).

Build only this phase. If the spec or plan turns out to be wrong or incomplete, stop and
tell the owner; continue once it's updated. Don't build something they don't say.

## 3. Converge

Before calling the phase done, make everything agree:

- Run the full test suite, plus lint and type checks.
- The phase's tasks are ticked and its criteria have passing tests (or, for visual items,
  have been shown to the owner).
- `plan.md` records any discoveries in Notes; `spec.md` still describes what was built.
- `ARCHITECTURE.md`, `DESIGN.md` and `docs/openrouter-api.md` still match the code.
- `CLAUDE.md` updated if commands, conventions or gotchas changed.
- Nothing was added beyond the phase.

If this was the last phase: set the plan to **Done** and the spec to **Built**.

## 4. Report

Summarize for the owner in plain language: what this phase delivered, how it was tested,
anything that changed from the spec or plan and why, and what the next phase is. Propose
how the work splits into logical commits; commit only when asked.
