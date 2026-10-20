# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Cosmion is a CLI (`cosmion`) for generating images with any model on OpenRouter,
bring-your-own-key, for developers and their agents. It's being built phase by phase from
`specs/001-cli/tasks.md`; the boxes ticked there are what exists.

**The rules live in `.specify/memory/constitution.md`**: how code is written, testing,
the agent interface, the feature workflow and git. Read it before any work; this file
doesn't repeat it.

Where things are:

- `specs/`: what's being built. `specs/001-cli` covers the whole CLI, shipping together as
  v0.1; when asked what's next, follow its tasks' phases.
- `docs/openrouter-api.md`: the OpenRouter endpoints, fields and pricing rules Cosmion
  uses, including what was checked against the live API. Check it before speccing
  anything that talks to OpenRouter.

## Commands

| Command | Does |
|---------|------|
| `npm run build` | `tsc` → `dist/` (`tsconfig.build.json`, `src/` only) |
| `npm test` | Vitest, all tests |
| `npm run lint` | Biome check, then `tsc --noEmit` over source and tests (`tsconfig.json`) |
| `npm run format` | Biome formats the code |
| `node dist/cli/main.js …` | Run the built CLI (or `npm link` once, then `cosmion …`) |

Each phase ends with lint, test and build passing.

`COSMION_TEST_OPENROUTER_URL=<url>` points the built CLI at a fake OpenRouter (FR-058). It's
test-only: keep it out of the README and `SKILL.md`.

Features go through **Spec Kit** (lean preset):

| Command | Use for |
|---------|---------|
| `/speckit-specify` | Start a feature: creates a numbered branch and `specs/<NNN-name>/spec.md` |
| `/speckit-clarify` | Resolve ambiguities in the spec before planning |
| `/speckit-plan` | `plan.md`: how it's built |
| `/speckit-tasks` | `tasks.md`: phased task checklist |
| `/speckit-analyze` | Check spec, plan and tasks agree before implementing |
| `/speckit-implement` | Build, one phase at a time |
| `/speckit-converge` | Compare what was built with the spec and add remaining work |
| `/speckit-checklist` | Optional: quality checklist for a spec |

Spec Kit's git extension has auto-commit turned off.

## Keeping this file current

Update `CLAUDE.md` as part of the work, without being asked, whenever something changes
how a future session should work here, in the same commit as the change that caused it:
commands added or changed, a convention established, a non-obvious gotcha discovered, or
a lasting instruction from the maintainer. Rules belong in the constitution (with the
maintainer's approval), not here.

Keep it short: replace or remove outdated lines rather than appending, and don't
duplicate the constitution, the docs above or the code. Mention the update to the
maintainer when it happens.
