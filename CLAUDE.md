# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Oriel is two products for generating images with any model on OpenRouter,
bring-your-own-key: the **CLI** (`oriel`, the primary product, for developers and their
agents, built first) and later a **desktop app** (Electron). They share code
(`packages/core`), never data (`ROADMAP.md`, `ARCHITECTURE.md`).

**No code exists yet.** The project is defined by these documents. Read the relevant one
before making decisions in its area:

- `ARCHITECTURE.md`: how it's built. Monorepo layout, process model, data flow, libraries,
  distribution, and a **decision log** with the reasons behind each choice.
- `DESIGN.md`: brand, look, feel and product experience (Welcome / Studio / Gallery,
  typography, glass, components).
- `ROADMAP.md`: build order (milestones and phases) and every deferred item. When asked
  what's next, follow it.
- `NOTES.md`: audience and direction, effort, license, landing page.
- `.specify/memory/constitution.md`: principles and development workflow.
- `docs/openrouter-api.md`: the OpenRouter endpoints, fields and pricing rules Oriel
  uses. Check it before speccing anything that talks to OpenRouter; items marked
  **(verify)** must be confirmed against the live API first.

Decisions in these docs are settled unless marked *(proposed)*, *(to validate)* or listed
as open questions. Don't re-litigate settled decisions; if one seems wrong, say so and
explain why rather than quietly deviating. When a decision changes or a new one is made,
update the matching doc (and the decision log for architecture) in the same piece of work.

Once the project is scaffolded, add the build, lint, test and run commands here (planned:
npm workspaces, Vitest; electron-vite from Milestone 2).

## Keeping this file current

Update `CLAUDE.md` as part of the work, without being asked, whenever something changes
how a future session should work here. Include the update in the same commit as the
change that caused it. Triggers:

- Commands are added or changed (build, test, lint, run, release).
- The structure or a big-picture rule above changes (principles change in the
  constitution, with the owner's approval).
- A convention is established (naming, file layout, a pattern to reuse).
- A non-obvious gotcha is discovered, e.g. something that broke and why.
- The owner gives a lasting instruction about how to work.

Keep it short and current: replace or remove outdated lines rather than appending, and
don't duplicate what's in the constitution, `ARCHITECTURE.md`, `DESIGN.md` or the code
itself. Mention
the update to the owner when it happens.

## The big picture

- TypeScript everywhere. `packages/core` holds the shared logic (OpenRouter client, model
  catalog, pricing, settings-file helper) and stores nothing itself.
- **The CLI and app are independent at runtime**: separate settings, history and images.
  Don't add anything that makes one read or depend on the other's data.
- The CLI saves images where asked (current folder or `--out`) and never touches them
  afterwards. Its ledger is an append-only JSON Lines file; no database in the CLI.
- The CLI is also an agent interface: `--json` on every command, data on stdout, logs on
  stderr, stable exit codes, no prompts without a TTY. Don't break these.
- App (Milestone 2): `core` and the library (images + SQLite) run only in Electron's main
  process. The renderer has no Node access and talks to main through a small typed
  preload API. The API key never reaches the renderer. UI is built only from the app's
  own components in `apps/desktop/src/ui` (React Aria based), never raw styled HTML in
  screens; standard controls start from React Aria's starter kits restyled via design
  tokens, and only the few custom surfaces listed in `DESIGN.md` → Components are
  built from scratch.

## Principles and workflow

**The rules for how code is written and features are built live in
`.specify/memory/constitution.md`**: simplicity, proportionate SOLID, one-person
maintainability, test-first, the stable agent interface and decoupled products. Read it
before any feature work. It isn't repeated here.

Features go through **Spec Kit** (lean preset), plus one project skill:

| Command | Use for |
|---------|---------|
| `/speckit-specify` | Start a feature: creates a numbered branch and `specs/<NNN-name>/spec.md` |
| `/speckit-clarify` | Resolve ambiguities in the spec before planning |
| `/speckit-plan` | `plan.md`: how it's built |
| `/speckit-tasks` | `tasks.md`: phased task checklist |
| `/speckit-analyze` | Check spec, plan and tasks agree before implementing |
| `/speckit-implement` | Build, one phase at a time (constitution IV and Development Workflow) |
| `/speckit-converge` | Compare what was built with the spec and add remaining work |
| `/speckit-checklist` | Optional: quality checklist for a spec |
| `/design <topic>` | Explore visual or interaction design as HTML prototypes before it's specced |

The owner approves the spec, the plan and the tasks before any code. Spec Kit's git
extension has auto-commit turned off; commits still happen only when asked.

**Design just ahead of build.** Settle the design foundations (tokens for color, type,
spacing, glass) early, then explore each screen with `/design` shortly before it's
specced. Prototypes live in `design/` and share `design/tokens.css`, which later becomes
the app's tokens.

## Git

- Git repository on `main`. Commit only when asked.
- Group changes into **logical commits**: one coherent change per commit (a feature, a
  fix, a refactor, a docs update), so each commit could be understood or reverted on its
  own.
- Avoid both extremes: don't bundle unrelated changes together, and don't split one
  change into tiny commits (e.g. one per file) unless that's genuinely clearer.
- Commit messages: a short summary line in the imperative ("Add ledger migrations"), then
  a body explaining why when it isn't obvious.
- Docs updates that belong to a change go in the same commit as that change.
