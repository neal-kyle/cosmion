# Feature Specification: Cosmion CLI

**Feature Branch**: `001-cli`

**Created**: 2026-10-17

**Status**: Approved by the maintainer, 2026-10-18. Amended 2026-10-29 (Story 13,
`cosmion skill`): approved by the maintainer, 2026-10-29

**Input**: User description: "look at the docs (including the openrouter one) and create a spec
to build the CLI. Follow the principles laid out in CLAUDE.md when creating it."

## Overview

`cosmion`: a command-line tool that generates images with any
image model on OpenRouter using the user's own key, saves them where asked, tells the user
what a generation will cost before spending, and keeps a private local record of what was
made and what it cost. It is built for developers and the agents they run, so every
command has a stable machine-readable interface.

Everything in this spec ships together as **v0.1**: `gen`, `models`, `price`, `history`,
`show`, `auth`, `batch`, `usage`, `regen`, `models rank`, `doctor`, `schema` and `skill`
(Stories 1–13). The build order is set by the tasks' phases, not by releases.

Ideas for later (OAuth sign-in, OS keychain, extra distribution channels, a TUI;
`docs/ideas/`) are not part of this spec. How it's built (`src/core` and `src/cli`, JSON Lines ledger, folders,
libraries) belongs to the plan and isn't repeated here. API details are in
`docs/openrouter-api.md`.

## Clarifications

### Session 2026-10-17

- Q: Should the spec cover only Milestones 1A + 1B, or also the CLI items in the roadmap's Later list? → A: 1A + 1B; Later items stay out.
- Q: Given that the key's spending limit (set on OpenRouter) is the real hard stop, what should `batch --budget` be? → A: A required per-run guard: rows start only while the budget has room; unknown-priced rows run one at a time and the first one's actual cost prices the rest; it can go over by at most one image.
- Q: Should `cosmion gen` require `--model` every time, or allow a default model? → A: `--model`, otherwise the `COSMION_MODEL` env var; neither → exit 2.
- Q: Which license should Cosmion be released under? → A: MIT.
- Q: Can the five open API questions be settled now with a few real generations? → A: Yes. Done on 2026-10-17 after topping up the account ($0.33 spent; see "Live API checks" below). Earlier attempts at a $0.52 balance were refused even for a $0.007 image (FR-040a), and showed that `GET /credits` works with an ordinary key (FR-048).

### Session 2026-10-18

- Q: Should 1A (v0.1) and 1B (v0.2 onward) stay separate releases? → A: No. All twelve stories ship together as v0.1; tasks still build them in phases.
- Q: What is the tool called? → A: Cosmion (renamed from Oriel, which had trademark and naming conflicts). The package is `cosmion`; it installs two commands, `cosmion` and the short `csn`. Docs and help use `cosmion`.
- Q: What happens when a batch image comes back without its cost, and can a batch run without a budget? → A: With `--budget`, Cosmion stops starting rows once it can't tell what's been spent; it never quietly stops counting. `--no-budget` is the only way past the cap: it must be passed explicitly, always prints a warning, and agents use it only when the user asks.
- Q: Should the short command be `csm` or `csn`? → A: `csn`.
- Q: What exit code does Ctrl-C give? → A: 130, the shell convention for an interrupted program, with nothing on stdout.
- Q: What about the environment variables the tests need? → A: `COSMION_HOME` is a real, documented feature (keep all files in one folder). The OpenRouter address override is test-only: named `COSMION_TEST_OPENROUTER_URL`, undocumented for users, not part of the stable interface.
- Q: Node 22+ or 22.12+? → A: 22.12+, which current `commander` and `vitest` need.
- Q: The catalog can list a price lower than what's charged (Riverflow), so a budgeted batch could overspend by more than one image. What then? → A: When a row finishes, its actual cost becomes the price of the remaining rows with the same model and settings whenever it's higher than the price they had (FR-073).
- Q: The first row of an unknown-priced group can ask for several images. Is the bound "one image" or "one row"? → A: One row (FR-073, SC-008). This replaces "at most one image" in the 2026-10-17 answer above.
- Q: Should a timeout say `retryable: true` when the provider may already have charged? → A: No. Cosmion's own 5-minute timeout is `retryable: false`; the message says to check openrouter.ai activity first (FR-017, FR-040).
- Q: `partial` is listed as an `error.code`, but exit 8 never prints an error. Keep it? → A: No, removed; exit 8 is unchanged (FR-040).
- Q: Does `batch --dry-run` need `--budget` or `--no-budget`? → A: No; it spends nothing (FR-071).

### Session 2026-10-25

- Q: A response can be charged and return no images. Record it? → A: Yes: a ledger entry with the cost and no images, exit 7, not retryable. The ledger should show everything spent; no extra field says why (the error message does).
- Q: With `--count 3` and one image back, is it named `cosmion-<id>.<ext>` or `cosmion-<id>-1.<ext>`? → A: `-1`: names follow the number asked for, the paths checked before sending.
- Q: Is the prompt sent exactly as given? → A: No: spaces and line breaks at its start and end are removed, so stdin's final newline isn't sent and a blank prompt counts as empty (FR-001).

### Session 2026-10-29

- Q: How does `SKILL.md` reach an agent? → A: `cosmion skill install` copies it into the agent's skills folder. It's part of v0.1. `npm install` doesn't ask or install anything itself: npm runs install scripts without a terminal and hides their output, many installs have no one to answer, and the package has no install scripts (FR-060).
- Q: Which agents? → A: Claude Code, Codex, OpenCode, Antigravity, Cursor, Grok Build and Copilot (FR-108); `--dir` installs into any other folder. Not Gemini CLI (replaced by Antigravity's CLI). Not Muse Code until its folders are confirmed from Meta's own documentation; `--dir` covers it meanwhile.
- Q: Which folder for each agent, when many read the shared `.agents/skills` as well as their own? → A: One fixed folder per agent and scope: its own where it has one, so a skill can go to one agent only (Codex may have image generation of its own, for instance), and `.agents/skills` for those without one. `shared` chooses that folder for every agent reading it. An agent that reads both `.claude/skills` and `.agents/skills` (OpenCode, Cursor, Grok Build; Copilot in a project) sees two identical copies when Claude Code is chosen too; that's accepted, as Vercel does.
- Q: Global or project? → A: Either, chosen at install. A project install goes in the project's folder, so it can be committed and shared.
- Q: Does the installed skill update with the CLI? → A: Not on its own. As `gh skill update` does, `cosmion skill update` finds Cosmion's copies by looking in the agents' folders and rewrites those from another version; `doctor` warns when one is out of date. An old copy still works; it just doesn't mention newer options. No links: a Node version manager moves the package, Windows often can't make them, and one agent (Cursor) is reported not to load them.
- Q: Should `skill update --all` update every project ever installed into? → A: No. It would need a lasting list of project paths; running `skill update` in that project fixes it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate an image into my project (Priority: P1)

A developer (or their agent) with an OpenRouter key runs one command with a prompt and a
model, and gets an image file saved in the current folder or exactly where they said,
along with what it actually cost.

**Why this priority**: It's the product. Everything else supports it.

**Independent Test**: With `OPENROUTER_API_KEY` set and a fake OpenRouter, run
`cosmion gen "a lighthouse" --model <id>` and check the file, the printed path and cost,
and the new ledger line.

**Acceptance Scenarios**:

1. **Given** a valid key, **When** I run `cosmion gen "a lighthouse at dusk" -m bytedance-seed/seedream-4.5`,
   **Then** an image is saved as `./cosmion-<id>.jpg` (Seedream returns JPEG), its path is
   printed, and a summary with id, model and actual cost is shown.
2. **Given** a valid key, **When** I run `cosmion gen "hero" -m <id> --out assets/hero.png`,
   **Then** the image is saved at exactly `assets/hero.png`, creating `assets/` if missing.
3. **Given** `--count 3 --out shots/`, **When** the model returns 3 images, **Then** they
   are saved as `shots/cosmion-<id>-1.<ext>` … `-3.<ext>` and all three appear in one
   ledger entry.
4. **Given** a model that accepts reference images, **When** I pass `--ref sketch.png`,
   **Then** the image is sent as a reference and the ledger records the reference's path.
5. **Given** a model whose capabilities don't include `quality`, **When** I pass
   `--quality high`, **Then** nothing is sent to OpenRouter, the CLI exits 2 and names the
   flag and the model.
6. **Given** `--out logo.png` already exists, **When** I run `gen` without `--force`,
   **Then** nothing is sent and the CLI exits 2; with `--force` the file is replaced.
7. **Given** the account's balance is too low, **When** I run `gen`, **Then** the CLI exits
   4 and points to `https://openrouter.ai/settings/credits`.

---

### User Story 2 - An agent drives Cosmion reliably (Priority: P1)

An AI agent uses `cosmion` as a tool: it reads structured output, branches on exit codes,
learns the tool from `--help` and `SKILL.md`, and is never left hanging on a prompt.

**Why this priority**: Agents are a primary audience; breaking this contract later is a
breaking change (constitution V), so it must be right from the first release.

**Independent Test**: Run every command with `--json`, stdin not a TTY, against a fake
OpenRouter; parse stdout as JSON and check exit codes for each success and failure case.

**Acceptance Scenarios**:

1. **Given** any command with `--json`, **When** it succeeds, **Then** stdout is exactly
   one JSON object and nothing else; progress and warnings go to stderr.
2. **Given** any command with `--json`, **When** it fails (other than by Ctrl-C), **Then**
   stdout is one JSON error object and the exit code matches the table in FR-040.
3. **Given** stdin is not a TTY, **When** a command would need interactive input,
   **Then** it exits 2 immediately with a message saying what to pass instead.
4. **Given** a rate-limit or server error, **When** reported, **Then** the error says
   `"retryable": true` so the agent knows it can try again.

---

### User Story 3 - Set up my key (Priority: P2)

A developer saves their OpenRouter key once, has it checked, and can see later which key
is in use and how much of its limit remains, without the key ever being printed.

**Why this priority**: Humans need it to start; agents can use the env var instead, so
`gen` is usable without it.

**Independent Test**: Run `cosmion auth` with a key on stdin (`--stdin`) against a fake
`/key` endpoint; check the settings file's contents and permissions, then `auth status`.

**Acceptance Scenarios**:

1. **Given** a terminal, **When** I run `cosmion auth` and paste a valid key, **Then** input
   is hidden, the key is checked with OpenRouter, saved to a file only I can read, and the
   key's label is shown.
2. **Given** an invalid key, **When** I run `cosmion auth`, **Then** nothing is saved and
   the CLI exits 3.
3. **Given** both `OPENROUTER_API_KEY` and a saved key, **When** I run `cosmion auth status`,
   **Then** it reports the env var as the source in use.
4. **Given** a saved key, **When** I run `cosmion auth logout`, **Then** the saved key is
   removed.

---

### User Story 4 - Choose a model and know the price first (Priority: P2)

A developer lists image models with their capabilities and prices, and asks what a
specific generation will cost before spending anything.

**Why this priority**: Exact prices before spending are a core promise of Cosmion, but
generating works without them.

**Independent Test**: With a fake catalog covering each pricing kind, run `cosmion models`,
`cosmion models <id>` and `cosmion price` and compare against expected prices.

**Acceptance Scenarios**:

1. **Given** a per-image model, **When** I run `cosmion price -m bytedance-seed/seedream-4.5`,
   **Then** it shows the exact price, `kind: "exact"`.
2. **Given** a model with tiered lines (`1k`, `2k`), **When** I run `price --resolution 2K`,
   **Then** it uses the `2k` line exactly.
3. **Given** a model served by two providers at different prices, **When** I run `price`,
   **Then** it shows the higher price as `kind: "at_most"`.
4. **Given** a per-token model I've used before with the same settings, **When** I run
   `price`, **Then** it shows an estimate from my last matching generation's token counts
   × the current per-token price, `kind: "estimate"`.
5. **Given** a per-token or per-megapixel model I haven't used with these settings,
   **When** I run `price`, **Then** it says the price will be known after the first image
   and shows the listed rate, `kind: "unknown"`.
6. **Given** a model with a line without a variant ($0.045) and a `high_resolution` line
   ($0.09), **When** I run `price --resolution 1K`, **Then** it shows $0.045 exactly; with
   `--resolution 2K`, $0.09 exactly.
7. **Given** a per-image model listed at $0.019 whose last matching generation was charged
   $0.031, **When** I run `price`, **Then** it shows ~$0.031, `kind: "estimate"`, with a
   note giving both figures.
8. **Given** a per-megapixel model I've used with the same settings, **When** I run
   `price`, **Then** it shows that generation's actual cost, `kind: "estimate"`.
9. **Given** the catalog cache is older than 24 hours, **When** I run any command needing
   it, **Then** it is refreshed first.

---

### User Story 5 - See what I made and what it cost (Priority: P3)

A developer lists recent generations and opens one in full detail, including whether the
image is still where it was saved.

**Why this priority**: Valuable record-keeping, and the ledger it reads is already written
by Story 1.

**Independent Test**: Seed a ledger file; run `cosmion history` and `cosmion show <id>`.

**Acceptance Scenarios**:

1. **Given** a ledger with 50 entries, **When** I run `cosmion history`, **Then** the 20
   newest are shown, newest first, with id, time, model, cost, prompt (shortened) and path.
2. **Given** an entry whose image was moved, **When** I run `cosmion show <id>`, **Then** the
   full entry is shown and the image is marked as no longer at its saved path.
3. **Given** an unknown id, **When** I run `cosmion show <id>`, **Then** the CLI exits 5.

---

### User Story 6 - Install from npm (Priority: P3)

A developer installs with `npm install -g cosmion` on Node 22.12+ and it works on macOS,
Windows and Linux with no build step (CI runs the tests on all three).

**Why this priority**: Required to ship, but has no behavior of its own.

**Independent Test**: The CI packaging check (FR-063).

**Acceptance Scenarios**:

1. **Given** Node 22.12+, **When** I install the packed tarball into an empty folder,
   **Then** `cosmion --version` and `cosmion --help` work.
2. **Given** Node older than 22.12, **When** I install, **Then** npm reports the engine
   requirement.

---

### User Story 7 - Generate many images within a budget (Priority: P2)

A developer or agent hands Cosmion a CSV or JSONL file of prompts and a dollar budget for
that run; Cosmion stops starting rows once the budget is used, and can pick up where it left
off after a failure. The key's own spending limit on OpenRouter stays the hard stop; the
budget limits one run without touching it. Running without a budget takes an explicit
`--no-budget`.

**Why this priority**: The biggest feature after `gen`, and the one where a bug costs real money.

**Independent Test**: Run `cosmion batch jobs.csv --budget 0.20` against a fake with known
prices; check files, ledger entries, the report and that spending stops at the cap.

**Acceptance Scenarios**:

1. **Given** a CSV with 5 rows at $0.04 each and `--budget 0.20`, **When** I run `batch`,
   **Then** all 5 are generated and the report shows $0.20 spent.
2. **Given** the same file and `--budget 0.10`, **When** I run `batch`, **Then** 2 rows
   are generated, 3 are reported `skipped_budget`, and the CLI exits 8.
3. **Given** row 4 has an option its model doesn't support, **When** I run `batch`,
   **Then** nothing is generated and the CLI exits 2 naming row 4.
4. **Given** `--dry-run`, **When** I run `batch`, **Then** the rows are validated and the
   total price is shown, and nothing is spent.
5. **Given** a batch where row 3 failed with a server error, **When** I run it again with
   `--resume <batch-id>`, **Then** only rows without a successful entry are generated, and
   the budget counts what the batch already spent.
6. **Given** 4 rows of a per-token model never used with those settings, **When** I run
   `batch`, **Then** the first row runs alone, its actual cost becomes the price of the
   other 3, and they're then budgeted like any other row.
7. **Given** neither `--budget` nor `--no-budget`, **When** I run `batch`, **Then** nothing
   is generated and the CLI exits 2 saying to pass one of them.
8. **Given** `--no-budget`, **When** I run `batch`, **Then** every row runs, stderr warns
   that the only cap is the key's spending limit on OpenRouter, and the report shows
   `"budget_usd": null`.
9. **Given** a budgeted batch whose first row has an unknown price and comes back without
   `usage.cost`, **When** it finishes, **Then** no further rows start, the rest are
   `not_run`, the CLI exits 8, and the message gives the command to continue with
   `--no-budget --resume <batch-id>`; resuming with `--budget` instead exits 2 with the
   same advice.

---

### User Story 8 - See what I've spent (Priority: P3)

A developer sees their total spending over a period, broken down by model or by day.

**Why this priority**: Useful, and it only reads the ledger.

**Independent Test**: Seed a ledger with known costs and dates; run `cosmion usage`.

**Acceptance Scenarios**:

1. **Given** a ledger, **When** I run `cosmion usage`, **Then** it shows the total cost,
   generations and images for the last 30 days, grouped by model.
2. **Given** `--since 2026-10-01 --by day`, **When** I run `usage`, **Then** it shows one
   row per day from that date.
3. **Given** entries with unknown cost, **When** I run `usage`, **Then** they are counted
   separately and not treated as $0.

---

### User Story 9 - Re-run a past generation exactly (Priority: P3)

A developer re-runs a past generation with the same model, prompt, settings, seed and
references, to get another copy or recover a deleted file.

**Why this priority**: Convenience built on the ledger.

**Independent Test**: Seed a ledger entry; run `cosmion regen <id>` against a fake and check
the request matches the original exactly.

**Acceptance Scenarios**:

1. **Given** a past entry, **When** I run `cosmion regen <id>`, **Then** OpenRouter receives
   the same model, prompt, settings, seed and references, and a new entry records
   `regen_of: <id>`.
2. **Given** a past entry whose local reference file no longer exists, **When** I run
   `regen`, **Then** nothing is sent and the CLI exits 2 naming the missing file.

---

### User Story 10 - Find the right model for a job (Priority: P3)

A developer asks which models can do what they need (e.g. 4K, transparent background, two
references) and sees them ranked cheapest first.

**Why this priority**: Helps choosing among 60+ models, but `models` and `price` already
answer it by hand.

**Independent Test**: With a fake catalog, run `cosmion models rank` with capability options
and check filtering and order.

**Acceptance Scenarios**:

1. **Given** `cosmion models rank --resolution 4K`, **When** run, **Then** only models that
   offer 4K are listed, cheapest first for 4K, unknown prices last.
2. **Given** `--refs 2 --background transparent`, **When** run, **Then** only models that
   accept 2+ references and a transparent background are listed.

---

### User Story 11 - Check that everything works (Priority: P3)

A developer or agent runs one command that checks the setup and says what's wrong and how
to fix it.

**Why this priority**: Saves support time; nothing depends on it.

**Independent Test**: Break each checked thing in a temporary setup (no key, bad key,
wrong file permissions, cut-off ledger line) and run `cosmion doctor --json`.

**Acceptance Scenarios**:

1. **Given** a healthy setup, **When** I run `cosmion doctor`, **Then** every check passes
   and it exits 0.
2. **Given** a settings file readable by others, **When** I run `doctor`, **Then** that
   check fails with the fix, and the CLI exits 8.

---

### User Story 12 - An agent discovers the whole interface (Priority: P2)

An agent asks the CLI for a machine-readable description of every command, option, output
shape and exit code, instead of parsing `--help`.

**Why this priority**: Makes Cosmion easy to wire into any agent harness.

**Independent Test**: Run `cosmion schema`; validate each command's real `--json` output in
the test suite against the shape it declares.

**Acceptance Scenarios**:

1. **Given** any release, **When** I run `cosmion schema`, **Then** it prints every command
   with its options, output JSON Schema and the exit code table.
2. **Given** the test suite, **When** every command's `--json` output is checked against
   its declared schema, **Then** all match.

---

### User Story 13 - Install the skill for my agents (Priority: P3)

A developer installs Cosmion's `SKILL.md` into the skills folder of the coding agents they
use, for all their projects or for one, and updates it after upgrading Cosmion.

**Why this priority**: Makes SC-007 (an agent working from `SKILL.md`) one command away;
copying the file by hand still works.

**Independent Test**: With a temp home folder and project folder, run
`cosmion skill install` for each agent and scope, then `skill update` with a different
version; check which files exist, their contents and the JSON output.

**Acceptance Scenarios**:

1. **Given** a terminal, **When** I run `cosmion skill install`, **Then** it asks whether to
   install globally or in this project, lists each agent with a folder of its own and the
   shared folder, nothing selected, and installs `SKILL.md` once per folder needed.
2. **Given** no terminal, **When** an agent runs
   `cosmion skill install --agent claude-code --global --json`, **Then** it installs
   without asking; without `--agent` or `--dir` it exits 2 saying what to pass.
3. **Given** OpenCode chosen, **When** I install, **Then** one copy is written, in its own
   folder, and Codex doesn't get it. Given the shared folder chosen, one copy is written,
   in `.agents/skills`, for every agent that reads it.
4. **Given** a copy from an older version, **When** I run `cosmion doctor`, **Then** it
   warns, with `cosmion skill update` as the fix, and that command updates it.
5. **Given** a `cosmion/SKILL.md` that Cosmion didn't install, **When** I install to that
   folder, **Then** it exits 2 and changes nothing, unless I pass `--force`.

---

### Edge Cases

- **Paid but not saved:** if the image can't be decoded or written after OpenRouter has
  charged for it, the ledger entry is still written with the cost and no saved images, and
  the CLI exits 1 explaining what happened. All path checks happen *before* the request
  (FR-012) so this only happens on failures like a full disk.
- **Fewer images than requested:** `n` is an upper bound; the CLI saves what comes back
  and the JSON shows how many. Names follow the number asked for, since those are the
  paths checked before sending: `--count 3` with one image back saves
  `cosmion-<id>-1.<ext>` (or `<stem>-1<ext>` with `--out`).
- **No images returned:** the ledger entry is still written with the cost and no images,
  so the ledger shows everything spent, and the CLI exits 7 with `"retryable": false`
  (retrying could pay twice), saying the request was charged and returned nothing.
- **Generation times out or is interrupted (Ctrl-C):** no ledger entry; the message says
  the provider may still have charged and to check openrouter.ai activity. Ctrl-C exits
  130; a timeout exits 7 with `"retryable": false`, since retrying could pay twice.
- **Cut-off last ledger line** (crash mid-write): skipped when reading, with a warning on
  stderr; other entries are unaffected.
- **Ledger entry from a newer CLI** (unknown format version): skipped with a warning.
- **Ledger can't be written** after a successful save: the image stays, a warning goes to
  stderr, exit 0 (the image, the main result, exists).
- **Several `cosmion gen` processes at once:** every entry lands as a complete line.
- **Model not in the cached catalog:** refresh once, then exit 5 if still unknown.
- **Catalog refresh fails** (offline) **with a cache present:** use the stale cache and warn.
  With no cache: exit 7.
- **Returned format differs from the `--out` extension** (the model has no
  `output_format` control, or ignores it: Riverflow lists only `jpeg` and returns WebP):
  write to the exact path anyway, warn on stderr, report the real format.
- **SVG output** (Recraft vector models): saved as `.svg`; width and height are `null`.
- **Missing `usage.cost`** in the response: cost recorded as `null`, warning on stderr.
- **Key set via env var while running `cosmion auth`:** the key is saved, with a warning that
  the env var takes precedence.
- **Batch interrupted** (Ctrl-C, crash): finished rows are already in the ledger;
  `--resume <batch-id>` continues.
- **Batch hits a credits or auth error:** no further rows start; running rows finish; the
  report marks the rest `not_run` and the CLI exits 4 or 3.
- **Batch row fails with a retryable error:** that row is marked `failed`; the batch goes on.
- **`regen` of an entry whose model was removed:** exits 5.
- **`regen` of an entry without a seed** (its model has no `seed` option): re-runs with
  the same settings; a warning on stderr says the result won't be identical.
- **Agents using one folder** (`codex`, `shared` and, in a project, `antigravity` use
  `.agents/skills`): one copy, listed with every chosen agent (FR-102).
- **Claude Code plus OpenCode or Grok Build:** those two also read `.claude/skills`, so
  they see two identical copies. Accepted (see Clarifications); Grok Build keeps one per
  name.
- **Uninstalling for one agent** removes the copy in its folder; other agents using that
  folder lose it too. The result lists them, and `skill install` puts it back.
- **Skill installed for an agent that isn't installed:** the folders are created anyway;
  choosing the agent is the user's call.
- **A teammate's clone** has a committed project copy: `doctor` and `skill update` find it,
  since copies are found by looking in the folders.

## Requirements *(mandatory)*

### Functional Requirements

**Generating: `cosmion gen <prompt> [--model <id>] [options]`**

- **FR-001**: `gen` MUST take the prompt as its argument, or read it from stdin when the
  argument is `-`. Spaces and line breaks at its start and end are removed (stdin ends
  with a newline); a prompt with nothing left exits 2.
- **FR-002**: The model MUST come from `--model`/`-m <id>`, otherwise the `COSMION_MODEL`
  env var; with neither, exit 2 suggesting `cosmion models`. The same applies to `price` and
  to `batch` rows without a `model` value.
- **FR-003**: `gen` MUST support these options, each mapped to the Images API field:
  `--aspect <ratio>` (`aspect_ratio`), `--resolution <r>` (`resolution`),
  `--quality <q>` (`quality`), `--background <b>` (`background`), `--count`/`-n <n>`
  (`n`), `--seed <int>` (`seed`), `--format <f>` (`output_format`),
  `--compression <0-100>` (`output_compression`), `--ref <path-or-url>` repeatable
  (`input_references`).
- **FR-004**: Only options the user passed MUST be sent; omitted options use the model's
  defaults. One exception: when the model supports `seed` and `--seed` isn't given, `gen`
  MUST pick a random seed, send it and record it, so `regen` can repeat the generation.
- **FR-005**: Each passed option MUST be validated against the model's
  `supported_parameters` from the catalog. An option the model doesn't list, or a value
  outside its enum/range, exits 2 with the allowed values in the message.
- **FR-006**: `--ref` MUST accept local image files (PNG, JPEG, WebP; sent as base64 data
  URLs) and `https://` URLs (sent as-is). It exits 2 if the model doesn't accept image
  input, if a file is unreadable or not one of those types, or if more refs are passed
  than the model's `input_references` maximum.
- **FR-007**: Without `--out`, images MUST be saved in the current folder as
  `cosmion-<id>.<ext>` (one image) or `cosmion-<id>-<k>.<ext>` (several, k from 1).
- **FR-008**: `--out <path>` MUST be treated as a folder if it is an existing folder or
  ends with a path separator (default names inside it), otherwise as a file path written
  exactly; with several images a file path becomes `<stem>-<k><ext>`. Missing parent
  folders are created just before the images are written, never by a command that sends
  nothing.
- **FR-009**: When `--out` has an image extension, `--format` isn't given and the model
  supports `output_format` with that value, the CLI MUST request that format.
- **FR-010**: The saved file's extension, when the CLI picks the name, MUST match the
  image's actual format, taken from the response item's `media_type` (`.png`, `.jpg`,
  `.webp`, `.svg`).
- **FR-011**: `gen` MUST never overwrite an existing file unless `--force` is passed.
- **FR-012**: Before any request to `POST /images`, `gen` MUST have checked: a key is
  available, the model exists, all options are valid, all refs are readable, and every
  output path is writable and free (or `--force`). Any failure exits without sending.
- **FR-013**: `gen` MUST decode each returned image and write it; it MUST NOT move, copy or
  delete images afterwards.
- **FR-014**: After saving, `gen` MUST append exactly one ledger entry for the request
  (FR-050) with the actual cost from `usage.cost`.
- **FR-015**: Text output: stdout MUST be the saved paths, one per line; stderr shows
  progress (only when stderr is a TTY) and one summary line with id, model and cost.
  `--json` prints the ledger entry (FR-050) as the result.
- **FR-016**: `gen` MUST NOT retry a failed generation automatically (a retry could be
  charged twice).
- **FR-017**: The generation request MUST time out after 5 minutes: exit 7 with
  `"retryable": false`, because the provider may already have charged; the message says to
  check openrouter.ai activity before trying again.

**Models: `cosmion models [<id>] [--refresh] [--json]`**

- **FR-020**: `models` MUST list every image model: id, name, whether it accepts reference
  images (and how many), its options, and a one-line price summary (FR-034 kinds): the
  price `cosmion price -m <id>` would show with no options.
- **FR-021**: `models <id>` MUST show one model in full: its options with allowed values,
  and per provider its name, `supported_parameters` and pricing lines.
- **FR-022**: The catalog (models plus their endpoint records) MUST be cached and refreshed
  when older than 24 hours, or immediately with `--refresh`. The catalog endpoints need no
  key.

**Price: `cosmion price [--model <id>] [gen options]`**

- **FR-030**: `price` MUST accept the same model and options as `gen` (no prompt; its cost
  is negligible), validate them the same way, and spend nothing.
- **FR-031**: Price MUST be computed only from each pricing line's `unit` and `billable`,
  never from the model's name.
- **FR-032**: Output line selection: if the model has one output line per provider, use it.
  If it has variant lines, a variant matches when its name equals the chosen
  `resolution` (case-insensitive, e.g. `2k` ↔ `2K`) or `<quality>_<resolution>` (e.g.
  `low_1k`); `high_resolution` matches any resolution above the lowest the model offers.
  Exactly one matching variant → that line. No variant matching a chosen resolution, and a
  line without a variant exists → that line (it's the base tier). Otherwise (no resolution
  chosen, or a variant name that can't be matched) → the highest output line, as a
  ceiling. If all candidate lines have the same price, it's exact.
- **FR-033**: Reference lines MUST be added when refs are passed: `input_image` /
  `input_reference` per `image` × number of refs, per `request` once. They are charged
  once per request, not again for each image `--count` asks for (assumed; checked live
  by T100).
- **FR-034**: The result MUST have one of four kinds:
  - `exact`: per-image price fully determined;
  - `at_most`: a ceiling (several providers at different prices, or FR-032 ambiguity);
  - `estimate`: from the newest ledger entry with the same model and the same settings
    (all options sent except prompt and seed, including the number of refs and an
    `output_format` implied by `--out` under FR-009, so `price --format png` matches
    `gen --out x.png`). The estimate is for the whole request, like that entry, and is
    never multiplied by `--count` again (the count is part of the settings). Per-token models:
    its `prompt_tokens` × the highest current input per-token price + `completion_tokens`
    × the current output per-token price. Per-megapixel models: its actual `cost_usd`
    (billing isn't linear in megapixels). Per-image models whose computed price differs
    from that entry's actual cost by more than $0.001: the actual cost, with a note
    giving both;
  - `unknown`: no matching history for those models, no pricing listed, or a `unit` Cosmion
    doesn't recognize. Never guessed.
- **FR-034a**: An `unknown` price of a model with an output line MUST add its rate to
  `notes`: every charge above $0, the output first, the highest across providers, as
  listed. All per token: `Rate per 1M tokens: $30 out, $8 image in, $5 text in`.
  Otherwise each charge has its unit: `Rate: $0.014/megapixel out`. No new JSON field; it
  doesn't change the kind or `cost_usd`. `price`'s text output heads it
  `Unknown until the first image with these settings` when a generation would give a price.
- **FR-035**: Per-image prices from the catalog MUST be multiplied by `--count` (default 1).
  Estimates (FR-034) aren't.
- **FR-036**: Any part of the cost the CLI can't compute (e.g. a pricing line whose
  `billable` it doesn't recognize) MUST be listed in `notes` and makes the kind no better
  than `estimate`.
- **FR-037**: Text output shows prices in USD: under $1 rounded to three significant
  figures with trailing zeros dropped (`$0.04`, `$0.007`, `$0.0387`, `$0.000123`), $1 or
  more with two decimals (`$1.25`, `$12.34`); prefixed `≤` for `at_most` and `~` for
  `estimate`. JSON keeps the full number.

**Agent interface (all commands)**

- **FR-040**: Exit codes MUST be stable:

  | Code | Meaning | `error.code` | Retryable |
  |------|---------|--------------|-----------|
  | 0 | Success | | |
  | 1 | Unexpected error, or a local write failed | `internal` | no |
  | 2 | Invalid usage or input (flags, values, files, paths, interactive input needed without a TTY, OpenRouter 400, 413, or a 403 refusal such as moderation) | `usage` | no |
  | 3 | No key, or key rejected (401) | `auth` | no |
  | 4 | Insufficient credits, or a key, org or workspace spending limit reached (402, or 403 naming a limit) | `credits` | no |
  | 5 | Unknown model or ledger id (incl. OpenRouter 404) | `not_found` | no |
  | 6 | Rate limited (429), or refused while other requests are running (402 `openrouter_in_flight_budget` with `Retry-After`) | `rate_limited` | yes |
  | 7 | OpenRouter, provider or network failure, or timeout (408, 5xx, 524) | `upstream` | yes, except Cosmion's own 5-minute timeout (FR-017) |
  | 8 | Finished, but some parts failed or were skipped (`batch` rows, `doctor` checks); not an error (FR-041) | | |
  | 130 | Interrupted (Ctrl-C); nothing on stdout, even with `--json` | | |

- **FR-040a**: For exit 4, the message MUST say what ran out (from the error's
  `metadata.limit_source` when present): the account's credits, the key's own limit, an
  org (guardrail) budget or a workspace budget. For credits it links to
  `https://openrouter.ai/settings/credits` and says that OpenRouter refuses generations
  when the balance is low, even if it covers the image's price. For a limit it keeps
  OpenRouter's message (figures and reset time) and says what to do: wait until
  `metadata.resets_at` when given (not when it is `null`, a limit that never resets), and
  raise the limit, ask the org admin, or use another key. An in-flight refusal without
  `Retry-After` says to add credits or run fewer at once.
- **FR-040b**: When OpenRouter sends a `Retry-After` of a number of seconds with a
  retryable error (429, 503, an in-flight 402), the message MUST say how long to wait.
- **FR-041**: `--json` MUST work on every command. Success: one JSON object on stdout.
  Failure: `{"error": {"code", "message", "retryable"}}` on stdout. Nothing else on stdout.
  The one exception is an interrupted command (Ctrl-C, exit 130), which prints nothing on
  stdout.
  Exit 8 is not a failure of the command: it prints the command's normal result (the
  `batch` report, the `doctor` checks), whose per-item statuses say what failed. A
  `batch` stopped by an auth or credits error (exit 3 or 4, FR-078) also prints its
  report, whose `stopped` holds that error.
- **FR-042**: Logs, progress and warnings MUST go to stderr only. Color and progress
  animation only when the stream is a TTY and `NO_COLOR` isn't set.
- **FR-043**: The CLI MUST never prompt when stdin isn't a TTY.
- **FR-044**: Every command MUST have `--help`; `cosmion --version` prints the version.
- **FR-044a**: The package MUST install the CLI as two commands, `cosmion` and `csn`, that
  behave identically. Help text, `SKILL.md` and the README use `cosmion` and mention `csn`
  as the short form.
- **FR-045**: A `SKILL.md` MUST ship in the npm package describing every command, option,
  JSON output shape and exit code. It tells agents to always pass `--budget` to `batch`
  and to use `--no-budget` only when the user asks for it; if a batch stops because a
  cost is unknown, the agent tells the user and suggests it rather than using it.

**Key**

- **FR-046**: The key MUST come from `OPENROUTER_API_KEY` if set, otherwise from the saved
  settings file.
- **FR-047**: `cosmion auth` MUST read the key with hidden input on a TTY, or from stdin with
  `--stdin`; without a TTY and without `--stdin` it exits 2. The key is checked with
  `GET /key` and saved only if valid, to a settings file with owner-only permissions (0600
  on macOS and Linux; on Windows the file sits in the user's own profile folder).
- **FR-048**: `cosmion auth status` MUST report the source (`env`, `file` or `none`) and,
  when a key exists, its validity, label, limit, limit remaining and usage from `GET /key`,
  and the account balance from `GET /credits` (`null` if that call is refused). It reports
  and exits 0 whether the key is valid, rejected (`"valid": false`) or missing
  (`"source": "none"`, the other fields `null`); only a network failure is an error
  (exit 7). `cosmion auth logout` removes the saved key.
- **FR-049**: The key MUST never appear in stdout, stderr, the ledger or the cache.

**Ledger: history and show**

- **FR-050**: Each ledger entry MUST be one JSON line with this shape (also `gen --json`'s
  output):

  ```json
  {
    "v": 1,
    "id": "k3f9x2ab",
    "created_at": "2026-10-17T14:03:11.204Z",
    "model": "bytedance-seed/seedream-4.5",
    "prompt": "a lighthouse at dusk",
    "settings": { "aspect_ratio": "16:9", "resolution": "2K" },
    "references": ["/home/me/site/sketch.png"],
    "images": [
      { "path": "/home/me/site/cosmion-k3f9x2ab.jpg", "width": 2560, "height": 1440, "format": "jpeg" }
    ],
    "cost_usd": 0.04,
    "usage": { "prompt_tokens": 17, "completion_tokens": 16384, "total_tokens": 16401 },
    "provider": "Seed",
    "generation_id": "gen-img-1792258557-72RzSYF8DvW74eAvO3UL",
    "batch_id": null,
    "row": null,
    "regen_of": null
  }
  ```

  `id` is 8 lowercase letters/digits, unique in the ledger. `settings` holds exactly the
  options sent (including a seed picked under FR-004). Paths are absolute. `provider` and
  `generation_id` come from the `x-provider-name` and `x-generation-id` response headers
  (`null` if absent). `batch_id` and `row` are set for `batch` jobs, `regen_of` for
  `regen`; otherwise `null`.
- **FR-051**: The ledger MUST be append-only; each entry is written in a single append.
- **FR-052**: Readers MUST skip lines that don't parse or have an unknown `v`, warning on
  stderr, and ignore fields they don't know. Adding a field doesn't change `v`; changing or
  removing one does.
- **FR-053**: `cosmion history [--limit <n>] [--model <id>] [--json]` MUST list entries newest
  first, 20 by default. JSON: `{"entries": [<entry>, …]}`.
- **FR-054**: `cosmion show <id> [--json]` MUST print the full entry, with `"exists": true|false`
  added to each image.

**Requests**

- **FR-055**: Every request to OpenRouter MUST send `X-OpenRouter-Title: Cosmion` (and
  `HTTP-Referer` once the project has a public URL).
- **FR-056**: OpenRouter responses MUST be validated where they enter; an unexpected shape
  (including an image item without `b64_json`) exits 7 with a message, never a crash
  trace.

**Environment**

- **FR-057**: `COSMION_HOME=<dir>` MUST put all of Cosmion's files (settings, ledger,
  catalog cache) under that folder instead of the per-OS defaults. The README and
  `SKILL.md` document it.
- **FR-058**: `COSMION_TEST_OPENROUTER_URL` replaces the OpenRouter address, so tests that
  run the real program can use a fake. It exists for the test suite only: it isn't in
  the README or `SKILL.md` and isn't part of the stable interface.
- **FR-059**: `COSMION_DEBUG=1` MUST add the stack trace of an unexpected error (exit 1) to
  stderr, for bug reports. The README documents it.

**Batch: `cosmion batch <file> (--budget <usd> | --no-budget) [options]`**

- **FR-070**: `batch` MUST read CSV (with a header row) or JSONL, chosen by the `.csv` or
  `.jsonl` extension. Each row has `prompt` (required), `model` (required unless `--model`
  or `COSMION_MODEL` is set), and optionally the `gen` options as columns: `aspect`, `resolution`,
  `quality`, `background`, `count`, `seed`, `format`, `compression`, `ref` (several refs
  separated by `|` in CSV, an array in JSONL) and `out`. Unknown columns exit 2.
- **FR-071**: Exactly one of `--budget <usd>` or `--no-budget` MUST be passed; neither or
  both exits 2, as does a budget that isn't a number greater than 0. With `--dry-run`
  neither is needed (nothing is spent) and one given is ignored. `--no-budget` MUST print a warning on stderr that the batch's only cap is
  the key's spending limit on OpenRouter, and its help text says agents use it only when
  the user asks. Options `--model`, `--out <folder>`
  (default for rows without `out`), `--concurrency <1-8>` (default 2), `--force`,
  `--dry-run`, `--resume <batch-id>` and `--json` are supported.
- **FR-072**: Every row that will run (all of them, except rows `--resume` skips) MUST be
  validated as `gen` validates (FR-012) before anything is spent, and no two rows may write
  the same path; any invalid row exits 2 with every bad row's number and reason.
- **FR-073**: The budget is a per-run guard (the key's OpenRouter limit is the hard
  stop). A row with a known price (`exact`, `at_most`, `estimate`) starts only if that
  price fits in the budget minus what the batch has spent and the prices of rows still
  running. A row with an `unknown` price starts only when no other row is running and the
  budget has room left; once it finishes, its actual cost is the price of the remaining
  rows with the same model and settings (the same settings include the count, so it's a
  price per row). Because the catalog can list less than is charged (Riverflow), the same
  applies to known prices: a finished row whose actual cost is higher than its price
  raises the price of the remaining rows in its group to that cost. Rows that never fit are
  `skipped_budget`. Spending is tracked from each finished row's actual `usage.cost`.
  So the batch can go over the budget only by one unknown-priced row, or, when the catalog
  underprices a model, by the shortfall on that group's rows that had already started
  before its first dearer row finished. With `--no-budget`, rows start as concurrency allows, whatever their price.
- **FR-073a**: With `--budget`, a finished row whose response has no `usage.cost` MUST
  count its price as spent if that price was known. If it wasn't, the budget can no
  longer be tracked: no further rows start, the rest are `not_run`, and the message gives
  the command to continue without a cap (`cosmion batch <file> --no-budget --resume
  <batch-id>`). The message is printed on stderr and is in the report's `stopped`
  (`{"code": "unknown_cost", "message"}`). The budget is never quietly weakened: on `--resume` such a row counts the
  same way, and if its price is still unknown, `--resume` with `--budget` exits 2 with the
  same advice.
- **FR-074**: Each finished row MUST append its own ledger entry with the batch's
  `batch_id` and its 1-based `row`.
- **FR-075**: A row failing with a retryable or `usage` error is marked `failed` and the
  batch continues; a `credits` or `auth` error stops new rows from starting (FR-040 code
  of that error), and the report's `stopped` holds that error's `code` and `message`. Rows are never retried automatically.
- **FR-076**: `--resume <batch-id>` MUST skip rows that have a ledger entry for that batch
  and row with at least one saved image; a row that was paid for but not saved runs
  again. All of that batch's earlier spending counts against `--budget`, and earlier
  actual costs set their groups' prices as in FR-073. The file is expected to be the
  same; rows are matched by number.
- **FR-077**: `--dry-run` MUST validate, print each row's price and the total, and spend
  nothing.
- **FR-078**: Exit 0 when every row succeeded; 3 or 4 when an auth or credits error
  stopped the batch (FR-075); otherwise 8 when any row failed, was skipped or didn't run.
  Text mode: saved paths on stdout, progress on stderr.

**Usage: `cosmion usage [--since <when>] [--until <when>] [--by model|day] [--json]`**

- **FR-080**: `usage` MUST total `cost_usd`, generations and images from the ledger over a
  period, grouped by model (default) or day. `--since`/`--until` take a date
  (`2026-10-01`) or a relative span (`7d`, `30d`); default is the last 30 days.
- **FR-081**: Entries with `null` cost MUST be counted in `unknown_cost_count`, not as $0.
- **FR-082**: Days are calendar days in the user's local time zone.

**Regen: `cosmion regen <id> [--out <path>] [--force] [--json]`**

- **FR-085**: `regen` MUST send the original entry's model, prompt, `settings` (including
  seed) and references unchanged; only the output location can be chosen (`--out`, same
  rules as `gen`; default is the current folder).
- **FR-086**: It MUST validate like `gen` before sending (model still exists and still
  supports the settings, local references still exist) and append a new entry with
  `regen_of`.

**Models rank: `cosmion models rank [gen options] [--refs <n>] [--json]`**

- **FR-090**: `models rank` MUST list only models that support every passed option and
  value (and at least `--refs` references), sorted by the price for those options
  (FR-034) cheapest first; `at_most` and `estimate` sort by their number; `unknown` last.

**Doctor: `cosmion doctor [--json]`**

- **FR-095**: `doctor` MUST run these checks, each `ok`, `warn` or `fail` with a fix: Node
  version; key present and its source; key accepted by `GET /key`; key limit nearly used
  (warn under 10% remaining); settings file permissions owner-only (macOS and Linux);
  OpenRouter reachable;
  catalog cache fresh or refreshable; config, data and cache folders writable; ledger
  readable (warn with the count of skipped lines).
- **FR-096**: Exit 0 when nothing fails (warnings allowed), 8 otherwise.
- **FR-097**: `doctor` MUST also check the installed skill: `warn` when a Cosmion copy in
  any global folder or the current project's folders (FR-108) is from another version,
  with `cosmion skill update` as the fix; otherwise `ok`, including when none is installed
  (the message then mentions `cosmion skill install`).

**Schema: `cosmion schema`**

- **FR-098**: `schema` MUST print (always JSON) the CLI version, every command with its
  arguments and options (name, alias, type, allowed values, required, repeatable,
  description), each command's output as JSON Schema, the error object's schema and the
  exit code table.
- **FR-099**: The schema MUST come from the same definitions the CLI uses to parse options
  and produce output, so it can't drift; tests validate real output against it.

**Skill: `cosmion skill install | update | uninstall`**

- **FR-100**: `cosmion skill install [--agent <name>]… [--dir <path>]… [--global | --project]
  [--force] [--json]` MUST write the CLI's own `SKILL.md` as `cosmion/SKILL.md` inside
  each chosen agent's folder for the chosen scope (FR-108), and inside each `--dir` (any
  folder an agent loads skills from). A project install uses the current folder as the
  project root. Missing folders are created.
- **FR-101**: When stdin is a TTY and neither `--agent` nor `--dir` is passed, `install`
  MUST ask global or project unless one was passed, then list every folder for that scope:
  each agent with its own, then the shared one, nothing selected. Arrow keys move, Space
  selects, Enter confirms; Enter with nothing selected asks again. Where a picker can't be
  drawn (`NO_COLOR`, `TERM=dumb`, stderr not a TTY), the same rows are numbered and the
  answer is typed; no answer exits 2. Without a TTY, it exits 2 when neither `--agent` nor `--dir` is passed, or when
  `--agent` is passed without `--global` or `--project`. Passing both `--global` and
  `--project`, or either with only `--dir`, exits 2.
- **FR-102**: Each distinct folder MUST be written once, and the result lists it with
  every chosen agent that uses it.
- **FR-103**: Each installed copy MUST carry the Cosmion version in its frontmatter
  (`metadata.cosmion-version`), which also marks it as Cosmion's. An existing
  `cosmion/SKILL.md` without that mark MUST NOT be replaced unless `--force` is passed
  (exit 2 before anything is written); one with the mark is replaced.
- **FR-104**: Cosmion MUST NOT change an installed copy except through `skill install`,
  `update` or `uninstall`, and keeps no list of where it installed.
- **FR-105**: `cosmion skill update [--dir <path>]… [--json]` MUST look in every global
  folder and every project folder of the current folder (FR-108), and in each `--dir`,
  rewrite each Cosmion-marked copy whose version isn't the running one, and report every
  marked copy found as `updated` or `current`. Unmarked files are left alone.
- **FR-106**: `cosmion skill uninstall [--agent <name>]… [--dir <path>]… [--global |
  --project] [--json]` MUST remove the Cosmion-marked copies in the chosen folders; with no
  options, those in every global folder and the current project's folders. It never asks,
  never removes an unmarked file, and removes the `cosmion` folder when it is left empty.
- **FR-107**: `skill install`, `update` and `uninstall` MUST never touch an agent's other
  skills or settings.
- **FR-108**: The agents and the one folder Cosmion uses for each (`~` is the user's home
  folder on every system; project folders are relative to the current folder):

  | `--agent` | Global | Project |
  |-----------|--------|---------|
  | `claude-code` | `~/.claude/skills` | `.claude/skills` |
  | `codex` | `~/.agents/skills` | `.agents/skills` |
  | `opencode` | `~/.config/opencode/skills` | `.opencode/skills` |
  | `antigravity` | `~/.gemini/config/skills` | `.agents/skills` |
  | `cursor` | `~/.cursor/skills` | `.cursor/skills` |
  | `grok-build` | `~/.grok/skills` | `.grok/skills` |
  | `copilot` | `~/.copilot/skills` | `.github/skills` |
  | `shared` | `~/.agents/skills` | `.agents/skills` |

  Each agent's documentation (checked with Context7 on 2026-10-29) lists the folder used.
  Rechecked on 2026-10-31: Copilot 1.0.105, Codex and Grok Build 1.0.70 by running them
  against test folders; Antigravity, OpenCode and Cursor against their documentation.
  Antigravity's app, IDE and CLI all read `~/.gemini/config/skills`. Grok Build reads
  `.agents/skills` in a trusted project, though its documentation lists only `.grok/skills`.
  An agent's own folder gives the skill to that agent alone, as far as Cosmion can: some
  agents also read others' folders (Cursor and Grok Build read Claude Code's, Grok Build
  reads Cursor's). `shared` is for every agent reading `.agents/skills`.

**Release**

- **FR-060**: The package MUST be `cosmion` on npm, MIT-licensed (a `LICENSE` file and the
  `license` field), require Node 22.12+ (`engines`), include no native modules, and ship as a
  single package.
- **FR-061**: The README MUST include install, a terminal example, an agent example, the
  privacy sentence (images and history stay on your machine; prompts and reference images
  go to OpenRouter and the model provider) and the tip to set a spending limit on the key.
- **FR-062**: CI MUST run all tests on every push on Linux, macOS and Windows, and publish
  to npm on a version tag.
- **FR-063**: CI MUST pack the CLI as npm would publish it, install it in an empty folder
  and run `cosmion --version` and `cosmion models --json` (against a fake) before publishing.
- **FR-064**: Tests MUST never call the real OpenRouter API or touch the user's real
  settings, ledger or cache.

### Key Entities

- **Ledger entry**: one generation request and its result (FR-050). Never edited.
- **Catalog**: image models with their options and, per provider, capabilities and pricing
  lines. Cached, refreshed daily.
- **Price result**: model, settings, kind, `cost_usd` (`null` when unknown), notes.
- **Batch**: a run of one input file under one budget, identified by `batch_id`; its rows'
  results live only as ledger entries (plus the printed report).
- **Settings file**: the saved key, owner-only.
- **Installed skill**: a copy of `SKILL.md` in an agent's skills folder, marked with the
  Cosmion version that wrote it. Found by looking in the folders; no list is kept.

### JSON output shapes (other commands)

- `models`: `{"models": [{"id", "name", "accepts_references", "max_references", "parameters", "price"}], "fetched_at"}`
- `models <id>`: `{"id", "name", "description", "parameters", "endpoints": [{"provider_name", "provider_tag", "supported_parameters", "pricing"}], "fetched_at"}`
- `price`: `{"model", "settings", "kind", "cost_usd", "notes": []}`
- `auth`: `{"saved": true, "label"}`; `auth status`: `{"source", "valid", "label", "limit_usd", "limit_remaining_usd", "usage_usd", "balance_usd"}`; `auth logout`: `{"removed": true|false}`
- `batch`: `{"batch_id", "budget_usd" (null with --no-budget), "spent_usd", "stopped" (null, or {"code", "message"} when the batch stopped early), "rows": [{"row", "status": "ok|failed|skipped_budget|skipped_resumed|not_run", "id", "paths", "cost_usd", "price", "error"}]}`; with `--dry-run`, `{"rows": [{"row", "price"}], "total": <price>}`
- `usage`: `{"since", "until", "by", "total_usd", "generations", "images", "unknown_cost_count", "groups": [{"key", "total_usd", "generations", "images", "unknown_cost_count"}]}`
- `regen`: the new ledger entry (as `gen`)
- `models rank`: `{"settings", "models": [{"id", "name", "price"}]}`
- `doctor`: `{"checks": [{"name", "status": "ok|warn|fail", "message", "fix"}]}`
- `schema`: `{"version", "commands": [...], "error", "exit_codes": [...]}`
- `skill install`: `{"installed": [{"path", "scope": "global|project|dir", "agents": [...]}]}` (`agents` is empty for `--dir`)
- `skill update`: `{"skills": [{"path", "status": "updated|current"}]}`
- `skill uninstall`: `{"removed": [{"path", "agents": [...]}]}` (`agents`: the listed agents that use that folder)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with an OpenRouter key goes from `npm install -g cosmion` to a saved
  image in under 2 minutes.
- **SC-002**: In a manual check across at least 5 per-image models, every `exact` price
  equals the charged `usage.cost`, except where the catalog itself is wrong (Riverflow,
  found 2026-10-17); there, after one generation, `price` shows the last actual cost.
- **SC-003**: Every command, run with `--json` in every success and failure case covered by
  the tests, produces stdout that parses as one JSON object (or nothing, when interrupted),
  with the documented exit code.
- **SC-004**: No test reaches the network or the user's real folders; the suite runs offline.
- **SC-005**: `history` and `show` respond in under 1 second with 10,000 ledger entries.
- **SC-006**: 20 concurrent `gen` runs against a fake produce 20 complete ledger lines.
- **SC-007**: An agent given only `SKILL.md` and `--help` can generate an image to a given
  path and report its cost without human help.
- **SC-008**: In tests against a fake, no batch run with `--budget` spends more than its
  budget when every price is known and charged as listed; never more than the budget plus
  one row when some are unknown; and when the fake charges more than the listed price, rows
  started after the first such row finishes are priced at the actual cost.

## Assumptions

- Images arrive as base64 in `data[].b64_json` with a `media_type` (checked live across
  five providers; none returned a URL).
- No saved default model (only `COSMION_MODEL`), no provider pinning, no streaming, no
  single-generation `--max-cost`; all can be added without breaking the interface.
- Text output layout (tables, wording) is for humans and may change; JSON output and exit
  codes may not without the maintainer's approval (constitution V).
- `doctor` doesn't check for newer CLI versions (no calls to npm).
- Out of scope (`docs/ideas/`): `cosmion auth login` (OAuth), OS keychain, standalone
  download, AUR and other package managers, the weekly pricing-format CI check, `cosmion tui`.

## Live API checks (2026-10-17)

The spec's **(verify)** items had to be checked against the live API before planning. All are
settled; details and figures in `docs/openrouter-api.md` → Charged vs listed.

1. **Image format:** always base64 with `media_type`; no URLs (FR-010, FR-056).
2. **Generation id and provider:** in the `x-generation-id` and `x-provider-name` response
   headers (FR-050).
3. **Per-token counts:** stable within 0.5% for the same settings, so `estimate` is sound
   (FR-034).
4. **Variant-less lines:** the base tier; `high_resolution` is above the lowest resolution
   (FR-032).
5. **Per-megapixel billing:** not linear, so Flux.2 is priced from the last actual cost
   (FR-034).
6. **Balance:** `GET /credits` works with an ordinary key (FR-048).

Also found: the catalog can list the wrong price (Riverflow v2.5 Fast charged ~$0.031,
listed $0.019), which FR-034's per-image `estimate` corrects after one generation; and
OpenRouter refuses generations at a low balance (FR-040a).
