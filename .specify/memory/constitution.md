# Oriel Constitution

Oriel is two products for generating images with any model on OpenRouter,
bring-your-own-key: the **CLI** (`oriel`, the primary product, for developers and their
agents, built first) and later a **desktop app**. They share code, never data. The
owner is not a full-time developer and maintains Oriel alone, with an AI agent; every
principle below serves that.

## Core Principles

### I. Simplest thing that works

Prefer the simplest solution that correctly handles the real cases, including edge cases
that can actually happen. Add complexity only for a concrete, present reason, not a
hypothetical future one.

- No abstraction until there are at least two real uses for it. Three similar lines beat
  a premature helper.
- No plugin systems, generic frameworks, config options or extension points nobody asked
  for.
- Add a dependency only when it clearly beats a few lines of our own code; prefer
  well-maintained, widely used libraries.
- Handle errors at the boundaries where they can occur (network, filesystem, database,
  user input). No defensive checks for impossible states.

### II. SOLID, proportionately

- **Single responsibility:** each module does one job (e.g. pricing doesn't know how the
  ledger is stored). Files stay small enough to read in one sitting.
- **Dependency inversion at real seams only:** the OpenRouter client, the ledger /
  library, and the settings/key store are passed in where that enables testing without
  network or real keys. Everything else just imports what it needs.
- **Skip the ceremony:** no interface for every class, no class hierarchies, no
  dependency-injection containers. Plain functions and modules are the default.

### III. Maintainable by one person

- Code reads plainly: clear names, obvious control flow, comments only where the *why*
  isn't evident.
- Follow existing patterns rather than introducing a second way of doing the same thing.
- When there's a real trade-off, explain it briefly in plain language and recommend one
  option.

### IV. Test-first, proportionately (NON-NEGOTIABLE where it applies)

For each requirement: write a failing test, show it fails, make it pass with the
simplest code, show it passes, then tidy up.

- **Strictly:** `packages/core` (pricing, model catalog), the CLI's ledger and its
  behavior (commands, `--json` output, exit codes), and later budget caps. This is where
  bugs cost money or break agents.
- **Behavior only:** UI components and app logic. Test what a component *does*, not how
  it looks.
- **Not test-first:** visual design, judged in `/design` prototypes and CI screenshots.
- Never call the real OpenRouter API or touch the user's real settings in tests; use
  injected fakes and a temporary data and config folder per test.
- Test through public functions and CLI output, not internal details.
- Never weaken or delete a test to make it pass. If a test is wrong, say so and fix it
  deliberately.

### V. Stable agent interface

The CLI is used by agents. `--json` on every command, data on stdout, logs on stderr,
stable exit codes, no prompts without a TTY. Changing any of these is a breaking change
and needs the owner's explicit approval.

### VI. Decoupled products

The CLI and the desktop app share code (`packages/core`) and never data: separate
settings, history and images. Nothing may make one read or depend on the other's data.

## Project Documents

These are the source of truth; specs and plans reference them rather than repeat them.

- `ARCHITECTURE.md`: how it's built, with a decision log.
- `DESIGN.md`: the app's brand, look and product experience.
- `ROADMAP.md`: build order and every deferred item.
- `docs/openrouter-api.md`: the OpenRouter API as Oriel uses it. Items marked
  **(verify)** must be checked against the live API before a spec depends on them.

Settled decisions in these documents aren't re-litigated quietly: if one seems wrong,
say so and explain why. When a decision changes, update the matching document (and the
decision log) in the same piece of work.

## Development Workflow

- Every feature or meaningful behavior change goes through Spec Kit: specify → clarify
  (when anything is ambiguous) → plan → tasks → analyze → implement. The owner approves
  the spec, the plan and the tasks; no tests or code before that.
- Specs describe behavior, not implementation, and stay short. CLI features include the
  exact commands, flags, JSON output and exit codes.
- Tasks are grouped into phases that each leave the project working and tested.
  Implement one phase at a time, then report and wait.
- If building reveals the spec was wrong, update the spec and tell the owner; the spec
  always matches what shipped.
- No spec needed for bug fixes that restore specced behavior, refactors that don't
  change behavior, dependency updates, or docs. A bug fix still starts with a failing
  test.
- Visual and interaction design is explored with `/design` before it's specced.

## Governance

This constitution guides every Spec Kit command. Plans that add complexity beyond these
principles must justify it in the plan. Amendments are made with the owner's approval
and recorded by bumping the version below.

**Version**: 1.0.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17
