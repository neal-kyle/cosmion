# Oriel Constitution

Oriel is a CLI (`oriel`) for generating images with any model on OpenRouter,
bring-your-own-key, for developers and their agents. The owner is not a full-time
developer and maintains Oriel alone, with an AI agent; every principle below serves
that.

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
- **Dependency inversion at real seams only:** the OpenRouter client, the ledger, and the
  settings/key store are passed in where that enables testing without
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

- **Strictly:** `src/core` (pricing, model catalog), the ledger and the CLI's behavior
  (commands, `--json` output, exit codes), and batch budgets. This is where
  bugs cost money or break agents.
- **Behavior only:** any interactive interface. Test what it *does*, not how it looks.
- **Not test-first:** visual design.
- Never call the real OpenRouter API or touch the user's real settings in tests; use
  injected fakes and a temporary data and config folder per test.
- Test through public functions and CLI output, not internal details.
- Never weaken or delete a test to make it pass. If a test is wrong, say so and fix it
  deliberately.

### V. Stable agent interface

The CLI is used by agents. `--json` on every command, data on stdout, logs on stderr,
stable exit codes, no prompts without a TTY. Changing any of these is a breaking change
and needs the owner's explicit approval.

### VI. Logic apart from interface, data per product

`src/core` holds the logic and never imports from the CLI, prints or exits the process.
If another product is ever built on this code, it shares that code and never data:
separate settings, history and images.

## Project Documents

These are the source of truth:

- `specs/`: each feature's spec, plan and tasks: what's built and how, including the
  technical decisions and their reasons.
- `docs/openrouter-api.md`: the OpenRouter API as Oriel uses it. Items marked
  **(verify)** must be checked against the live API before a spec depends on them.

Settled decisions in these documents aren't re-litigated quietly: if one seems wrong,
say so and explain why. When a decision changes, update the matching document in the
same piece of work.

Every tracked file will be public. Nothing promises work that isn't specced; anything
about possible future work is worded as an idea, never a plan.

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

### Git

- Work happens on `main` or a Spec Kit feature branch. Commit only when the owner asks.
- One coherent change per commit (a feature, a fix, a refactor, a docs update), so each
  can be understood or reverted on its own. Don't bundle unrelated changes, and don't
  split one change into tiny commits (e.g. one per file) unless that's genuinely clearer.
- Docs updates that belong to a change go in the same commit as that change.
- Messages: a short summary line in the imperative ("Add ledger migrations"), then a body
  explaining why when it isn't obvious.

## Governance

This constitution guides every Spec Kit command. Plans that add complexity beyond these
principles must justify it in the plan. Amendments are made with the owner's approval
and recorded by bumping the version below.

**Version**: 1.3.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17
