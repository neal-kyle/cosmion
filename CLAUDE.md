# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Cosmion is a CLI (`cosmion`) for generating images with any model on OpenRouter,
bring-your-own-key, for developers and their agents. All thirteen commands of v0.1 are built
(`specs/001-cli/tasks.md`; unticked boxes there are the maintainer's manual release
checks). Code lives in `src/` (`core/` logic, `cli/` commands and I/O), tests in `tests/`.
`SKILL.md` (shipped to agents) and `README.md` are user docs: update them, and the
`tests/skill-md.test.ts` they must pass, whenever a command, option or exit code changes.

**The rules live in `.specify/memory/constitution.md`**: how code is written, testing,
the agent interface, the feature workflow and git. Read it before any work; this file
doesn't repeat it.

Where things are:

- `specs/`: records of how each feature was built, not kept up to date after merging.
  `specs/001-cli` covers the whole CLI (v0.1).
- `docs/openrouter-api.md`: the OpenRouter endpoints, fields and pricing rules Cosmion
  uses, including what was checked against the live API. Check it before speccing
  anything that talks to OpenRouter.
- `DESIGN.md`: how the CLI looks on a terminal. A command's terminal output goes in its
  `pretty` function; its `text` is for pipes and agents and doesn't change with the look.

## Commands

| Command | Does |
|---------|------|
| `npm run build` | `tsc` → `dist/` (`tsconfig.build.json`, `src/` only) |
| `npm test` | Builds first (`pretest`), then Vitest, all tests. `tests/concurrency.test.ts` runs `dist/`, so a bare `npx vitest` needs a fresh build |
| `npm run lint` | Biome check, then `tsc --noEmit` over source and tests (`tsconfig.json`) |
| `npm run format` | Biome formats the code |
| `npm run pack-check` | Packs and installs the package in a temp folder, then runs it against the fake (`scripts/pack-check.mjs`; needs network for the install) |
| `node dist/cli/main.js …` | Run the built CLI (or `npm link` once, then `cosmion …`) |

Each change ends with lint, test and build passing. Releasing: bump `version` in
`package.json`, merge to `main`, push a tag `v<version>`; CI publishes to npm once every
system passes.

`COSMION_TEST_OPENROUTER_URL=<url>` points the built CLI at a fake OpenRouter (FR-058);
`serveFakeOpenRouter()` in `tests/helpers/fake-openrouter.ts` serves one. It's test-only:
keep it out of the README and `SKILL.md`.

New capabilities go through **Spec Kit** (lean preset):

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
