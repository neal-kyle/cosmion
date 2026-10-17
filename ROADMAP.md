# Oriel — roadmap

The order things get built. Each item becomes one or more specs (`/speckit-specify`)
when its time comes. Nothing here is dropped; deferred items wait in **Later**.

**The CLI is the primary product and is built first** (decided 2026-10-17). The desktop
app comes after, as its own product: they share code, not data (`ARCHITECTURE.md`).

---

## Milestone 1: Oriel CLI

Published to npm (`npm install -g oriel`). Each phase is a release.

### 1A. First release (v0.1)

Before the first spec: resolve the **(verify)** items in `docs/openrouter-api.md` that
1A depends on (image format in responses, generation id, fixed tokens per image size,
how tier-less price lines apply, the balance endpoint), by checking the live API.

- `packages/core`: OpenRouter client (Images API), model catalog, exact pricing,
  settings-file helper.
- The CLI's ledger (JSON Lines).
- Key setup: `OPENROUTER_API_KEY` env var, or `oriel auth` (paste the key with hidden
  input; checked against OpenRouter; saved to the user-only settings file).
- Commands: `gen` (saves to the current folder or `--out`), `models`, `price`,
  `history`, `show`, `auth`.
- Agent rules: `--json`, stable exit codes, no prompts without a TTY, `SKILL.md`.
- README with the privacy sentence and the spending-limit tip.
- CI: tests, and the packaging check before publishing to npm.
- Pick the license (MIT or Apache-2.0) before the first publish.

### 1B. Power features (v0.2+)

- `batch`: CSV/JSONL input with a hard USD budget cap.
- `usage`: spend summary over a period.
- `regen`: exact re-run of a past generation.
- `models rank`: rank models by cost and capability.
- `doctor`: health check.
- `schema`: all commands and flags as JSON for agents.

## Milestone 2: Oriel desktop app

Starts once the CLI is shipped. Everything in `DESIGN.md` and the app parts of
`ARCHITECTURE.md`: Welcome, Studio, Gallery, threads, the design system, the app's own
library, security and distribution.

- **Revisit the audience first.** The app is a standalone studio, not a companion to the
  CLI, and not aimed specifically at designers. Who it's for affects whether Mac signing
  (below) is needed at launch.
- Design foundations first (`/design`: color, type, spacing, glass tokens), then each
  surface just ahead of its spec. Design exploration can start any time; app code waits
  for Milestone 1.
- Sign in with OpenRouter (OAuth) arrives here.
- Downloads on GitHub Releases: macOS `.dmg`, Windows installer, AppImage and `.deb`.
  "New version available" notice.

## Later

Rough order.

**Distribution**

1. **AUR packages** (CLI and app). First addition: many projects ignore AUR, and Oriel
   shouldn't. The CLI could go on AUR as soon as Milestone 1A ships.
2. Flatpak, Homebrew, winget, scoop: as people ask.
3. Standalone CLI download for people without Node.
4. Automatic app updates (needs a signed macOS app; Windows and Linux could have them
   sooner).
5. Apple Developer membership ($99/yr) for a signed, notarized Mac app, if the app's
   audience needs it: the unsigned-app warning stops most non-developers.

**Features**

- `oriel auth login`: sign in with OpenRouter from the CLI.
- API keys in the OS keychain instead of a user-only file.
- Model recommendations in the app's model picker (`DESIGN.md` → Studio).
- Optional weekly CI check that flags OpenRouter pricing units or tier names Oriel
  doesn't recognize.
