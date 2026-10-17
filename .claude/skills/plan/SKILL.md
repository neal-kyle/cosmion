---
name: plan
description: Write the implementation plan for an approved Oriel spec, broken into phases of tasks that can each be built separately, and get it approved. Use after a spec is approved, before building.
argument-hint: <feature name>
---

# /plan: phases and tasks

Feature: $ARGUMENTS (in `specs/<feature>/`)

Stop after step 4. No tests or code in this skill.

## 1. Check

- `spec.md` must say **Status: Approved**. If not, stop and suggest `/spec`.
- Read the spec (including Clarifications) and the doc sections it references.
- Look at the existing code it will touch, so the plan follows existing patterns.

## 2. Write

Copy `specs/_templates/plan.md` to `specs/<feature>/plan.md` and fill it in.

- **Approach:** a few plain-language sentences the owner can follow. Call out anything
  heavier than usual (new dependency, new database table, change to a settled decision)
  with a one-line reason; prefer plans that need none.
- **Phases:** each one leaves the project working and tested, so building can stop
  after any phase. Order them so the riskiest or most foundational part comes first.
  Small features have one phase.
- **Tasks:** a checklist per phase. Each is small enough to finish in one sitting and
  names the acceptance criteria it covers. Together the tasks cover every criterion.
- Follow `CLAUDE.md`'s principles: the simplest approach that handles the real cases,
  no abstractions or options the spec doesn't need.

## 3. Review

Check the plan against the spec: every acceptance criterion and edge case is covered by
a task, and no task builds something the spec doesn't ask for. Fix gaps before showing
it.

## 4. Approve

Explain the plan to the owner in plain language: the approach, the phases and what each
delivers, and anything heavier than usual. On approval, set **Status: Approved**.

Next step: `/build <feature> <phase>`.
