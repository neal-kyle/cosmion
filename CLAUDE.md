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
- The structure or a big-picture rule above changes.
- A convention is established (naming, file layout, a pattern to reuse).
- A non-obvious gotcha is discovered, e.g. something that broke and why.
- The owner gives a lasting instruction about how to work.

Keep it short and current: replace or remove outdated lines rather than appending, and
don't duplicate what's in `ARCHITECTURE.md`, `DESIGN.md` or the code itself. Mention
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

## Working principles

The owner is not a full-time developer and maintains this alone, with an AI agent. Every
choice should keep the project understandable and maintainable by one person.

**Simplest thing that works.** Prefer the simplest solution that correctly handles the
real cases, including edge cases that can actually happen. Add complexity only for a
concrete, present reason, not a hypothetical future one. In practice:

- No abstraction until there are at least two real uses for it. Three similar lines beat
  a premature helper.
- No plugin systems, generic frameworks, config options or extension points nobody asked
  for.
- Add a dependency only when it clearly beats a few lines of our own code, and prefer
  well-maintained, widely used libraries.
- Handle errors at the boundaries where they can occur (network, filesystem, database,
  user input). Don't wrap internal code in defensive checks for impossible states.

**SOLID, proportionately.** Apply the parts that pay off at this size:

- **Single responsibility**: yes. Each module does one job (e.g. pricing doesn't know
  how the ledger is stored). Files stay small enough to read in one sitting.
- **Dependency inversion at real seams only**: the OpenRouter client, the ledger / library,
  and the settings/key store are passed in rather than imported directly where that
  enables testing without network or real keys. Everything else just imports what it needs.
- **Skip the ceremony**: no interface for every class, no class hierarchies, no
  dependency-injection containers. Plain functions and modules are the default.

**Maintainable by one person.**

- Code reads plainly: clear names, obvious control flow, comments only where the *why*
  isn't evident.
- Follow the existing patterns in the codebase rather than introducing a second way of
  doing the same thing.
- When there's a real trade-off, explain it briefly in plain language and recommend one
  option. Use your judgment; don't just ask.

## How work flows

Five project skills give the work structure. The rules below apply whether or not a
skill was invoked; the skills hold the step-by-step.

| Skill | Steps | Use for |
|-------|-------|---------|
| `/design <topic>` | explore 2–3 prototypes → iterate → settle into `DESIGN.md` | visual or interaction questions, before they're built |
| `/spec <feature>` | draft → clarify → owner approves `spec.md` | every feature or meaningful behavior change |
| `/plan <feature>` | phases of tasks → check against spec → owner approves `plan.md` | approved specs |
| `/build <feature> [phase]` | one phase: tests first → code → converge spec, plan, docs and code | approved plans, one phase at a time |
| `/analyze [feature]` | check docs, specs, plans and code agree → report → fix what the owner approves | anytime: before a new feature, after doc edits, when things feel out of sync |

**Design just ahead of build.** Don't design everything up front. Settle the foundations
(tokens for color, type, spacing, glass) early, since every component uses them; explore
each screen or signature surface with `/design` shortly before its spec is built.
Prototypes live in `design/` and share `design/tokens.css`, which later becomes the
app's tokens.

## How features get built: spec, then tests, then code

Spec-driven and test-driven, kept lightweight. The point is fewer surprises, not
paperwork.

### 1. Spec first

Every feature or meaningful behavior change gets a folder in `specs/` (e.g.
`specs/pricing/`) with two files from `specs/_templates/`:

- `spec.md`: what the feature does, its acceptance criteria, the edge cases that matter,
  what's out of scope, and the owner's answers to clarifying questions.
- `plan.md`: how it's built, as phases that each leave the project working, with a
  checklist of tasks per phase. Written after the spec is approved.

- Write the spec, clarify ambiguities with the owner, and get approval; then write the
  plan and get approval. **No tests or code before both are approved.**
- Build one phase at a time.
- Keep it short: usually under a page. It describes behavior, not implementation.
- `ARCHITECTURE.md` and `DESIGN.md` stay the big picture; specs are feature-level and
  reference them rather than repeat them.
- If building reveals the spec was wrong or incomplete, update the spec (and tell the
  owner) rather than letting code and spec drift apart. The spec always matches what
  shipped.
- **No spec needed** for bug fixes that restore specced behavior, refactors that don't
  change behavior, dependency updates, or docs. A bug fix still gets a test that
  reproduces the bug first.

### 2. Tests before code

For each acceptance criterion: write a failing test, make it pass with the simplest code,
then tidy up. Run the tests and show they fail before implementing, and pass after.

Where TDD applies, proportionately:

- **Strictly:** `packages/core` (pricing, model catalog), the CLI's ledger and its
  behavior (commands, `--json` output, exit codes), and later budget caps. This is where
  bugs cost money or break agents.
- **Behavior only:** UI components and app logic. Test what a component *does* (keyboard
  handling, states, what it calls), not how it looks.
- **Not TDD:** visual design. That's judged in prototypes, Storybook and the CI
  screenshots described in `ARCHITECTURE.md`.

Testing rules:

- Never call the real OpenRouter API or touch the user's real settings in tests; use the
  injected fakes (see Dependency inversion above). Use a temporary data and config folder
  per test.
- Test through public functions and CLI output, not internal details, so refactoring
  doesn't break tests.
- Never weaken or delete a test to make it pass. If a test is wrong, say so and fix it
  deliberately.

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
