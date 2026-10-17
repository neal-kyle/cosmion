---
name: analyze
description: Check that Oriel's docs, specs, plans and code agree with each other, report every inconsistency, and fix the ones the owner approves. Use to bring everything back in sync, before starting a feature, or after docs were edited by hand.
argument-hint: "[feature name, or empty for the whole project]"
---

# /analyze: find drift, then converge

Scope: $ARGUMENTS (empty = whole project; a feature name = that feature's spec and plan,
plus everything they touch).

Report first. Change nothing until the owner says which findings to fix.

## 1. Read

`CLAUDE.md`, `ARCHITECTURE.md` (including the decision log), `DESIGN.md`, `ROADMAP.md`,
`NOTES.md`, `docs/openrouter-api.md`, the specs and plans in scope, the skills in `.claude/skills/`,
and the code if any exists.

## 2. Check

**Docs against each other**

- Contradictions: the same thing described differently in two places (a library, a name,
  a behavior, a number).
- Decisions in the decision log or marked settled that aren't reflected everywhere.
- Open questions or *(proposed)* items that have actually been decided elsewhere.
- References that point to things that don't exist (files, sections, commands).
- The same content duplicated in two docs (it will drift; one should point to the
  other).

**Specs and plans**

- Spec and plan statuses agree with each other and with reality.
- Every acceptance criterion and edge case is covered by a plan task; no task goes
  beyond the spec.
- Specs don't contradict `ARCHITECTURE.md`, `DESIGN.md` or `docs/openrouter-api.md`.
- Ticked tasks and **Built** specs actually exist in the code, with tests for their
  criteria.

**Code against docs** (once code exists)

- The structure and big-picture rules in `CLAUDE.md` and `ARCHITECTURE.md` hold (e.g. the
  renderer never touches the API key; app and CLI don't call each other).
- Commands listed in `CLAUDE.md` actually work.
- CLI commands, flags and exit codes match the docs.
- Behavior with no spec behind it, other than small fixes.

## 3. Report

A numbered list, most important first, each with: where (file and section), what
disagrees, and a recommended fix in one line. Group as:

- **Conflicts:** two sources disagree; something will be built wrong.
- **Stale:** outdated text that misleads but won't break anything.
- **Gaps:** missing coverage (untested criterion, untasked edge case).
- **Tidy:** duplication or wording.

Say plainly if everything is in sync. Don't report style preferences.

## 4. Converge

Apply the fixes the owner approves. Where a fix means choosing between two conflicting
decisions, ask; don't pick. Update the decision log when a decision changes. Summarize
what changed.
