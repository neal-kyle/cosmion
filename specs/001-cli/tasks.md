# Tasks: Cosmion CLI

**Input**: [spec.md](spec.md), [plan.md](plan.md), `docs/openrouter-api.md`

**Branch**: `001-cli` | **Date**: 2026-10-18

**Status**: Approved by the maintainer, 2026-10-18

## How to use this list

- Format: `- [ ] T### [P] [US#] Description (file)`. `[P]` means it can run in parallel
  with the other `[P]` tasks next to it (different files, no dependency between them).
  `[US#]` is the user story in the spec.
- **Test-first (constitution IV):** in every phase the test tasks come first. Write the
  test, run it and see it fail for the right reason, then do the implementation task(s)
  that make it pass, then tidy up. Never weaken a test to make it pass.
- Every command test goes through `runCli` (T010), which checks that `--json` output is
  exactly one JSON object matching the command's declared schema. So SC-003 and FR-099
  are checked by every command test, not listed again below.
- **One phase at a time.** Each phase ends with `npm run lint`, `npm test` and
  `npm run build` passing. Then stop, report to the maintainer and wait.
- **Open questions:** none. The plan's four were decided on 2026-10-18 and are in the
  spec (T001).
- The phases follow the plan's build order, one for one.
- Tasks added after the first draft carry a letter (e.g. T025a) so the other numbers
  stay put.
- "Register it" means adding one line to `src/cli/commands/index.ts`. `[P]` tasks that
  each register a command touch that file only for that line.

---

## Phase 1: Setup

**Goal**: An empty but buildable, lintable, testable TypeScript package with CI on three
operating systems.

- [x] T001 Update the spec and plan with the maintainer's answers to the plan's four open questions (done 2026-10-18: `--no-budget` and FR-073a, exit 130, FR-057 `COSMION_HOME` and FR-058 `COSMION_TEST_OPENROUTER_URL`, Node 22.12+)
- [x] T002 Create `package.json`: `name: "cosmion"`, `type: "module"`, `bin` for `cosmion` and `csn` → `dist/cli/main.js`, `files: ["dist", "SKILL.md"]`, `license: "MIT"`, `engines.node: ">=22.12.0"`; scripts `build`, `test`, `lint`, `format`; runtime deps `commander`, `zod` (v4), `env-paths`, `csv-parse`, `image-size`; dev deps `typescript`, `vitest`, `@biomejs/biome`, `@types/node@22`
- [x] T003 [P] Create `tsconfig.json` (strict, ES modules via `NodeNext`, type-checks source and tests, no output) and `tsconfig.build.json` (`rootDir: src`, `outDir: dist`); `.gitignore` (`node_modules/`, `dist/`); `.gitattributes` forcing LF so Biome's format check passes on Windows
- [x] T004 [P] Create `biome.json` (lint + format); `npm run lint` runs Biome's check and `tsc --noEmit`
- [x] T005 [P] Create `vitest.config.ts` that sets `COSMION_HOME` to a fresh temp folder for the whole run, so nothing can reach the user's real folders, and a setup file `tests/helpers/setup.ts` that replaces the global `fetch` with one that throws, so no test can reach the network (SC-004, FR-064)
- [x] T006 Write `tests/boundary.test.ts`: reads every file under `src/core` and fails on an import from `../cli`, `console.`, `process.exit`, `process.stdout` or `process.stderr` (constitution VI). Show it fails with a temporary violating file in `src/core`, then remove that file
- [x] T007 [P] Create `src/cli/name.ts`: the tool's name once (folder name `cosmion-cli`, env prefix `COSMION_`, file prefix `cosmion`, title `Cosmion`)
- [x] T008 Create `.github/workflows/ci.yml`: on every push, Ubuntu, macOS and Windows with Node 22: `npm ci`, lint, test, build (FR-062; pack-check and publishing come in Phase 11)
- [x] T009 Add the build, lint, test, format and run commands from the plan to `CLAUDE.md`

**Checkpoint**: `npm run lint`, `npm test`, `npm run build` pass locally; CI is green on all three systems.

---

## Phase 2: Foundational — agent interface skeleton (US2)

**Goal**: Commands defined as data; `--json`, errors, exit codes, `--help` and
`--version` working for any command. No real commands yet; tests use small test-only
command definitions passed to `run()`.

**Tests first**

- [x] T010 [US2] Create `tests/helpers/run-cli.ts`: `runCli(args, options)` makes a temp `COSMION_HOME` and cwd, runs in-process with a given `fetch`, env, stdin, TTY flags and command list, returns `{ exitCode, stdout, stderr, json }`, and with `--json` asserts stdout is exactly one JSON object matching the command's `output` schema (or the error schema), except that exit 130 must leave stdout empty (FR-041)
- [x] T011 [US2] Write `tests/cli/run.test.ts` with test-only command definitions: `--version` prints the `package.json` version and exits 0; `--help` and `<command> --help` print to stdout and exit 0; a definition with `subcommands` works with and without the parent's own `run` and positional argument (`parent`, `parent <arg>`, `parent child`), with `--help` at each level; the top-level `--help` mentions `csn` as the short form (FR-044a); an unknown command or option exits 2; a non-integer value for an integer option exits 2; with `--json` each failure prints exactly `{"error": {"code": "usage", "message", "retryable": false}}` and nothing else on stdout
- [x] T012 [US2] In `tests/cli/run.test.ts`: a thrown `CosmionError` maps to its FR-040 exit code, `code` and `retryable` (`rate_limited` and `upstream` retryable, except an `upstream` error thrown with `retryable: false`, as the timeout is); any other thrown error is `internal`, exit 1, one-line message, stack trace on stderr only with `COSMION_DEBUG=1` (FR-059); a result with `exitCode: 8` prints the normal result (not an error) and exits 8; an aborted signal exits 130 with nothing on stdout, even with `--json`
- [x] T013 [US2] In `tests/cli/run.test.ts`: text mode prints `text(data)` on stdout; warnings go to stderr only; no ANSI codes when stderr isn't a TTY or `NO_COLOR` is set; the key from `OPENROUTER_API_KEY` is replaced if it appears in any message written to stdout or stderr (FR-049)

**Implementation**

- [x] T014 [P] Create `src/core/errors.ts`: `CosmionError { code, message, retryable }` and the error codes
- [x] T015 [P] Create `src/cli/exit-codes.ts`: the FR-040 table once, including 130 Interrupted
- [x] T016 [P] Create `src/cli/context.ts`: the `Context` type (`env`, `cwd`, `stdin`/`stdout`/`stderr` with TTY flags, `fetch`, `baseUrl`, `signal`, `platform`, `nodeVersion`)
- [x] T017 Create `src/cli/output.ts`: print one JSON object, print text, `warn()` to stderr, colors via `util.styleText` only on a TTY without `NO_COLOR`, a small stderr spinner, key redaction
- [x] T018 Create `src/cli/define.ts`: `defineCommand()` and the option-definition type (name, flag, alias, type, values, required, repeatable, description; `output` zod schema; `run`; `text`; optional `subcommands`)
- [x] T019 Create `src/cli/run.ts`: build a commander program from a list of command definitions (default: `src/cli/commands/index.ts`), including subcommands, add `--json` to every command, convert values by declared type, `exitOverride` and `configureOutput` so commander never exits or prints by itself, map errors to exit codes and print
- [x] T020 Create `src/cli/commands/index.ts` (empty list for now) and `src/cli/main.ts` (`#!/usr/bin/env node`; real context, with `platform` and `nodeVersion` from `process`, `baseUrl` from `COSMION_TEST_OPENROUTER_URL` (FR-058) or `https://openrouter.ai/api/v1`; SIGINT → `AbortSignal`; `process.exitCode` from `run()`)

**Checkpoint**: `node dist/cli/main.js --version` and `--help` work; all Phase 2 tests pass.

---

## Phase 3: Catalog and `models` (US4)

**Goal**: `cosmion models` and `cosmion models <id>` from a cached catalog, against a fake
OpenRouter.

**Tests first**

- [x] T021 [P] [US4] Create catalog fixtures in `tests/helpers/fixtures/catalog/` (models list + endpoint records), one model per case, using real ids and figures from `docs/openrouter-api.md` where they exist: single per-image line (Seedream 4.5, $0.04, JPEG); tiered `1k`/`2k` lines; variant-less + `high_resolution` (Seedream 5 Pro, $0.045/$0.09); two providers at different prices (a Gemini model); one provider with two endpoints at different prices; per-token (Gemini 2.5 Flash Image); per-megapixel (Flux.2 Klein, no `resolution` option); no pricing (Krea); an unknown `unit`; an unknown `billable`; `unit: request` reference line (Recraft styles); SVG output (Recraft v4.1 Vector); Riverflow v2.5 Fast ($0.019 listed, WebP returned); `quality_resolution` variants (`low_1k`, `medium_2k`)
- [x] T022 [P] [US4] Create `tests/helpers/fake-openrouter.ts`: a `fetch`-compatible function serving the fixtures at `GET /images/models` and `…/endpoints`, configurable per test (error status, delay, failure of one route), recording every request (method, path, headers, body)
- [x] T023 [US4] Write `tests/core/openrouter.test.ts`: HTTP status → `CosmionError` per the table in `docs/openrouter-api.md` (400 usage, 401 auth, 402 credits, 404 not_found, 429 rate_limited retryable, 500/502/529/524 upstream retryable); a `fetch` that throws is upstream, retryable; an unexpected response shape is upstream with a message, not a crash (FR-056); every request sends `X-OpenRouter-Title: Cosmion` (FR-055); catalog requests send no `Authorization` (FR-022); the 402 message names `metadata.limit_source`, links `https://openrouter.ai/settings/credits` and explains the low-balance refusal (FR-040a)
- [x] T024 [US4] Write `tests/cli/models.test.ts`: `models` lists every image model with `id`, `name`, `accepts_references`, `max_references` (from `input_references` range), `parameters`, and `fetched_at` (FR-020; `price` comes in Phase 4); `models <id>` shows `description`, `parameters` with allowed values and per endpoint `provider_name`, `provider_tag`, `supported_parameters`, `pricing` (FR-021); text output is readable on stdout
- [x] T025 [US4] In `tests/cli/models.test.ts`, caching: a second run makes no catalog requests; a cache older than 24 hours is refreshed first (Story 4.9); `--refresh` always refreshes; a failed refresh with a cache uses it and warns on stderr; with no cache exits 7; an unknown id refreshes once, then exits 5
- [x] T025a [P] [US4] Write `tests/cli/paths.test.ts`: with `COSMION_HOME` set, the config, data and cache folders are `config/`, `data/` and `cache/` under it, and nothing else is used (FR-057; T005's safety net depends on it); without it, the folders come from `env-paths` for `cosmion-cli` with no `-nodejs` suffix

**Implementation**

- [x] T026 [US4] Create `src/core/openrouter.ts`: base URL passed in, `X-OpenRouter-Title`, status → `CosmionError` mapping, zod schemas for the catalog responses; `listImageModels()` and `getEndpoints(id)`
- [x] T027 [US4] Create `src/core/catalog.ts`: build the catalog (models + endpoint records) at most 8 requests at a time, fail the whole refresh if any request fails; look up a model; references accepted and maximum
- [x] T028 [P] [US4] Create `src/cli/paths.ts`: config, data and cache folders from `envPaths('cosmion-cli', { suffix: '' })`, or `config/`, `data/`, `cache/` under `COSMION_HOME` (FR-057)
- [x] T029 [US4] Create `src/cli/catalog-cache.ts`: load `catalog.json` from the cache folder; refresh when missing, older than 24 hours or asked; write via temp file + rename; stale cache + warning on failure; one refresh for an unknown model
- [x] T030 [US4] Create `src/cli/commands/models.ts` (`models [id] [--refresh]`) and register it in `src/cli/commands/index.ts`

**Checkpoint**: `models` and `models <id>` pass against the fake, with caching behavior.

---

## Phase 4: Options, pricing and `price` (US4)

**Goal**: `cosmion price` gives the right kind and amount for every pricing case; `models`
gains its price summary.

**Tests first**

- [ ] T031 [P] [US4] Write `tests/core/money.test.ts`: USD ↔ integer nano-dollars; `0.2 − 4 × 0.04` leaves exactly `0.04`; per-token prices below a millionth of a dollar survive the round trip
- [ ] T032 [P] [US4] Write `tests/core/options.test.ts`: an option whose key is absent is unsupported; `enum` accepts only listed values; `range` only integers in range; errors name the flag and the model and list the allowed values (FR-005); the random seed is within the model's `seed` range, or 0–2,147,483,647 (FR-004); the "same settings" key ignores `seed` and key order and includes the number of references
- [ ] T033 [US4] Write `tests/core/pricing.test.ts`, one test per fixture case: Story 4 scenarios 1–8; FR-032 line selection (case-insensitive `2k` ↔ `2K`, `<quality>_<resolution>`, `high_resolution` above the lowest resolution, variant-less line as the base tier, unmatched variant → highest line as `at_most`, equal candidate prices → `exact`); FR-033 reference lines (`image` unit × refs, `request` unit once); FR-035 × `n`; FR-036 unknown `billable` → note, kind no better than `estimate`; unknown `unit` and no pricing → `unknown`, `cost_usd: null`; per-token estimate uses the highest current input per-token price; per-megapixel estimate is the last actual cost; an estimate with `--count 2` matching an entry made with `n: 2` is that entry's figure, not doubled (FR-034, FR-035); per-image actual cost differing by more than $0.001 → that cost as `estimate` with both figures in `notes`; combining kinds takes the weakest (`exact` → `at_most` → `estimate` → `unknown`)
- [ ] T034 [US4] Write `tests/cli/ledger.test.ts` (reading): entries are parsed with the FR-050 schema; a cut-off or unparseable line and an unknown `v` are skipped with a stderr warning; unknown fields pass through (FR-052); finding the newest entry with the same model and settings
- [ ] T035 [P] [US4] Write `tests/cli/refs.test.ts`: local PNG, JPEG and WebP files become base64 data URLs, with the type taken from the bytes, not the extension; `https://` URLs pass unchanged; exit 2 for a model without image input, an unreadable file, another file type, or more refs than the model's `input_references` maximum (FR-006); ledger paths are absolute
- [ ] T036 [US4] Write `tests/cli/price.test.ts`: model from `--model`/`-m`, then `COSMION_MODEL`, neither → exit 2 suggesting `cosmion models` (FR-002); invalid options exit 2 like `gen` (FR-030); nothing is sent to `POST /images`; estimates come from a seeded ledger file; JSON `{"model", "settings", "kind", "cost_usd", "notes"}`; text uses `formatUsd` with `≤…` for `at_most` and `~…` for `estimate` (FR-037)
- [ ] T036a [P] [US4] Write `tests/cli/format-usd.test.ts` with every FR-037 example: `$0.04`, `$0.007`, `$0.0387`, `$0.000123` (three significant figures, trailing zeros dropped), `$1.25`, `$12.34` (two decimals from $1), and the `≤`/`~` prefixes
- [ ] T037 [US4] Extend `tests/cli/models.test.ts`: each model in `models` has a one-line `price` with its FR-034 kind, equal to what `price -m <id>` gives with no options (FR-020)

**Implementation**

- [ ] T038 [P] [US4] Create `src/core/money.ts`
- [ ] T039 [P] [US4] Create `src/core/options.ts`: gen options ↔ API fields, validation against `supported_parameters`, the "same settings" key, the random seed
- [ ] T040 [US4] Create `src/core/pricing.ts`: `price(model, { settings, refCount }, lastMatch)` and combining kinds
- [ ] T041 [P] [US4] Create `src/cli/gen-options.ts`: the nine gen option definitions (FR-003) shared by `gen`, `price`, `models rank` and batch columns
- [ ] T042 [P] [US4] Create `src/cli/ledger.ts` (entry zod schema per FR-050, read, find newest match) and `src/cli/refs.ts`
- [ ] T043 [US4] Add `formatUsd` to `src/cli/output.ts`: under $1, three significant figures without trailing zeros (`$0.04`, `$0.007`, `$0.0387`); $1 or more, two decimals (`$12.34`); `≤`/`~` prefixes (FR-037)
- [ ] T044 [US4] Create `src/cli/commands/price.ts`, register it, and add the price summary to `src/cli/commands/models.ts`

**Checkpoint**: every pricing case in `docs/openrouter-api.md` → Charged vs listed has a passing test.

---

## Phase 5: Key — `auth`, `auth status`, `auth logout` (US3)

**Goal**: Save, check and remove the key, never printing it.

**Tests first**

- [ ] T045 [P] [US3] Write `tests/core/settings-file.test.ts`: written with mode 0600, and an existing file is reset to 0600 (skipped on Windows); replaced atomically (temp + rename); reading a missing file returns nothing
- [ ] T046 [US3] Extend `tests/helpers/fake-openrouter.ts` with `GET /key` (valid, 401) and `GET /credits` (200, 403)
- [ ] T047 [US3] Write `tests/cli/auth.test.ts`: `auth --stdin` with a valid key saves it and returns `{"saved": true, "label"}`; an invalid key saves nothing and exits 3; without a TTY and without `--stdin` exits 2 before reading anything, with a message saying to pass `--stdin` (Story 2.3, FR-043, FR-047); with `OPENROUTER_API_KEY` set the key is saved with a warning that the env var takes precedence
- [ ] T048 [US3] In `tests/cli/auth.test.ts`, on a fake TTY stdin (behavior only): input isn't echoed, Backspace removes a character, Enter finishes, Ctrl-C aborts without saving and exits 130
- [ ] T049 [US3] In `tests/cli/auth.test.ts`: `auth status` reports `source` `env` (when both exist), `file` or `none` (with the other fields `null`, exit 0), and `valid`, `label`, `limit_usd`, `limit_remaining_usd`, `usage_usd`, `balance_usd` (`null` when `/credits` is refused) (FR-048); a rejected key is `valid: false` with exit 0; a network failure exits 7; `auth logout` returns `{"removed": true}` then `{"removed": false}`
- [ ] T050 [US3] In `tests/cli/auth.test.ts`: across all auth commands the key never appears in stdout, stderr or any file other than the settings file (FR-049)

**Implementation**

- [ ] T051 [P] [US3] Create `src/core/settings-file.ts`
- [ ] T052 [P] [US3] Add `getKey()` and `getCredits()` to `src/core/openrouter.ts`
- [ ] T053 [P] [US3] Create `src/cli/key.ts` (env var, then settings file) and `src/cli/hidden-input.ts`
- [ ] T054 [US3] Create `src/cli/commands/auth.ts` (`auth`, `auth status`, `auth logout`) and register it

**Checkpoint**: Story 3's scenarios pass.

---

## Phase 6: Ledger and `gen` (US1, US2) 🎯 MVP

**Goal**: `cosmion gen` generates, saves and records an image. After this phase the tool
does its main job.

**Tests first**

- [ ] T055 [P] [US1] Write `tests/core/ids.test.ts`: 8 characters from `a–z0–9`; a new id is drawn if it's already taken
- [ ] T056 [P] [US1] Write `tests/cli/out-paths.test.ts`: default `cosmion-<id>.<ext>` / `cosmion-<id>-<k>.<ext>` in the cwd (FR-007); `--out` as an existing folder or ending in `/` or `\` → default names inside; otherwise an exact file path, `<stem>-<k><ext>` for several images, no extension written exactly (FR-008); missing parent folders created; an existing file refused without `--force` (FR-011), including `cosmion-<id>` with any of the four extensions
- [ ] T057 [US1] Extend `tests/helpers/fake-openrouter.ts` with `POST /images`: configurable images (`b64_json`, `media_type`), count, `usage` (with or without `cost`), `x-provider-name` and `x-generation-id` headers, error status, delay; and extend `tests/cli/ledger.test.ts` (appending): one complete line per entry, written in one append (FR-051)
- [ ] T058 [US1] Write `tests/cli/gen.test.ts`, the happy paths: Story 1 scenarios 1–4; the model from `COSMION_MODEL` when `--model` isn't given (FR-002); prompt from stdin with `-`, empty prompt exits 2 (FR-001); each option sent under its API field and only passed options sent (FR-003, FR-004); a random seed sent and recorded when the model supports `seed`; `--out x.png` requests `output_format: png` when supported (FR-009); the extension follows `media_type` (FR-010); one ledger entry with `cost_usd`, `usage`, `provider`, `generation_id`, absolute paths, dimensions (FR-014, FR-050); text mode prints paths on stdout and one summary line on stderr, progress only when stderr is a TTY (FR-015); `--json` prints the entry
- [ ] T059 [US1] In `tests/cli/gen.test.ts`, nothing is sent when a pre-check fails (FR-012; assert no `POST /images` was recorded): no key (exit 3), unknown model (exit 5), unsupported option (Story 1.5, exit 2), bad ref, output path taken (Story 1.6), output folder not writable (for a folder that doesn't exist yet, the nearest existing one above it) — and no missing folder is created when nothing is sent; with `--force` an existing file is replaced
- [ ] T060 [US2] In `tests/cli/gen.test.ts`, failures from OpenRouter: 400 → 2; 401 → 3; 402 → 4 with the FR-040a message (Story 1.7); 404 → 5; 429 → 6 with `"retryable": true`; 5xx → 7 retryable (Story 2.4); exactly one request each, never retried (FR-016); a response without `b64_json` or of an unexpected shape → 7 (FR-056); a request still running after 5 minutes → 7 with `"retryable": false` and the "may still have been charged" message (FR-017, with fake timers)
- [ ] T061 [US1] In `tests/cli/gen.test.ts`, the spec's edge cases: fewer images than requested are saved and reported; a write failure after a charge writes a ledger entry with no images and exits 1; an image whose dimensions can't be read is kept with `null` dimensions and a warning; a returned format differing from the `--out` extension is written to the exact path with a warning and the real format; SVG has `null` width and height; missing `usage.cost` → `cost_usd: null` and a warning; a ledger that can't be written after saving → warning, exit 0; the key appears nowhere in the ledger (FR-049); Ctrl-C (aborted signal) → no ledger entry, the "may still have been charged" message, exit 130 (FR-040)
- [ ] T062 [US1] Add a local HTTP server mode to `tests/helpers/fake-openrouter.ts` (same handler on a random port) and write `tests/concurrency.test.ts`: 20 real `node dist/cli/main.js gen` processes with `COSMION_HOME` and `COSMION_TEST_OPENROUTER_URL` produce 20 complete ledger lines (SC-006). Add a `pretest` script that builds, so `dist/` is current, and note in `CLAUDE.md` that `COSMION_TEST_OPENROUTER_URL` (FR-058) points the built CLI at a fake

**Implementation**

- [ ] T063 [P] [US1] Create `src/core/ids.ts`
- [ ] T064 [P] [US1] Add `generateImages()` to `src/core/openrouter.ts`: `POST /images` with the key, 5-minute timeout from a plain `setTimeout` + `AbortController` (not `AbortSignal.timeout`, which fake timers don't control) combined with the context's abort signal, the abort reason telling a timeout (`upstream`, not retryable) from Ctrl-C, zod-validated response, provider and generation id from headers
- [ ] T065 [P] [US1] Create `src/cli/out-paths.ts`
- [ ] T066 [US1] Add `appendEntry()` to `src/cli/ledger.ts` (open with `a`, one `write` of entry + `\n`)
- [ ] T067 [US1] Create `src/cli/generate.ts`: **Prepare** (id, model, options, seed, refs, implied `output_format`, output paths checked; writes nothing) and **Execute** (create missing parent folders, request, decode, write with `wx` unless `--force`, dimensions via `image-size`, ledger entry)
- [ ] T068 [US1] Create `src/cli/commands/gen.ts` and register it

**Checkpoint**: Story 1 and Story 2 scenarios pass; a real `gen` works against the fake server.

---

## Phase 7: `history` and `show` (US5)

**Goal**: Read back what was made and what it cost.

**Tests first**

- [ ] T069 [US5] Write `tests/cli/history.test.ts`: with 50 seeded entries, the 20 newest, newest first, with id, time, model, cost, shortened prompt and path in text mode (Story 5.1); `--limit` and `--model`; JSON `{"entries": [...]}` (FR-053); a cut-off last line is skipped with a warning; 10,000 entries in under 1 second, timing only the command, with the ledger written before the timer starts (SC-005)
- [ ] T070 [P] [US5] Write `tests/cli/show.test.ts`: the full entry with `"exists": true|false` on each image (Story 5.2, FR-054); an unknown id exits 5 (Story 5.3)

**Implementation**

- [ ] T071 [P] [US5] Create `src/cli/commands/history.ts` and register it
- [ ] T072 [P] [US5] Create `src/cli/commands/show.ts` and register it

**Checkpoint**: Story 5 scenarios pass.

---

## Phase 8: `batch` (US7)

**Goal**: Many images from a file under a budget, resumable. This is where a bug costs
real money: test the scheduler exhaustively before wiring it up.

**Tests first**

- [ ] T073 [US7] Write `tests/core/batch.test.ts` for the scheduler with fake rows and timings: rows start in file order; a known-price row starts only if it fits in budget − spent − running prices, otherwise waits for a running row, and with nothing running is `skipped_budget`; an `unknown`-price row starts alone only when nothing runs and spent < budget, and its actual cost prices the rest of its group (a price per row, since the group shares the count); a finished row that cost more than its group's price raises that price for rows not yet started, and prices are never lowered (FR-073); concurrency is never exceeded; spending is the sum of actual costs; already-spent money (resume) counts; a `credits` or `auth` error stops new rows, running rows finish, the rest are `not_run`; a retryable or `usage` failure marks the row `failed` and the batch continues (FR-075)
- [ ] T074 [US7] In `tests/core/batch.test.ts`, SC-008 over many generated cases with fixed prices: never more than the budget when every price is known; never more than the budget plus one row when some are unknown, including rows with `count` above 1; when the fake charges more than the listed price (Riverflow-style), rows started after the first such row finishes are priced at the actual cost; a finished row with no `usage.cost` counts its known price, and if its price was unknown too, starts no further rows (rest `not_run`) (FR-073a); with no budget, a row starts whenever a slot is free, whatever its price
- [ ] T075 [P] [US7] Write `tests/cli/batch-file.test.ts`: CSV with header, byte-order mark, CRLF, quoted commas and newlines, `|`-separated refs; JSONL with refs as an array; parser chosen by `.csv`/`.jsonl`, anything else exits 2; unknown columns, a missing `prompt` and bad values (e.g. `count` not an integer) are reported with their row number (FR-070)
- [ ] T076 [US7] Write `tests/cli/batch.test.ts`: Story 7 scenarios 1–4, 6 and 7; exactly one of `--budget` and `--no-budget`, neither or both exits 2, and a `--budget` that isn't a number above 0 exits 2 (FR-071; the two are separate options, since commander would otherwise read `--no-budget` as switching `--budget` off); `--no-budget` runs every row, warns on stderr before the first starts and reports `budget_usd: null` (Story 7.8); rows default to `--model`/`COSMION_MODEL` and `--out <folder>`; `--concurrency` outside 1–8 exits 2; every invalid row is listed in one exit-2 error before anything is spent (FR-072); two rows writing the same path are refused; each finished row has its own ledger entry with `batch_id` and `row` (FR-074); `--dry-run` needs neither `--budget` nor `--no-budget` and ignores them (FR-071), shows each row's price and the total, and with any unknown row the total is `unknown` with the known subtotal and unknown count in `notes` (FR-077)
- [ ] T077 [US7] In `tests/cli/batch.test.ts`, resume and stopping: `--resume <batch-id>` skips rows with an entry that saved at least one image (`skipped_resumed`, not revalidated), re-runs a paid-but-not-saved row, and counts all of the batch's earlier spending, with earlier actual costs setting their groups' prices (Story 7.5, FR-076); a budgeted batch stopped by an unknown cost exits 8, with the `--no-budget --resume <batch-id>` command on stderr and in `stopped: {"code": "unknown_cost", "message"}`; resuming it with `--budget` exits 2 with the same advice, and with `--no-budget` it continues (Story 7.9, FR-073a); an earlier entry with no cost but a known price counts that price; a credits error exits 4 and an auth error 3, with the rest `not_run` and that error in `stopped`; `stopped` is `null` when nothing stopped the batch; exit 0 when all succeed, otherwise 8 (FR-078); text mode prints paths on stdout and the batch id on stderr at the start; Ctrl-C leaves finished rows in the ledger and exits 130 (FR-040)

**Implementation**

- [ ] T078 [US7] Create `src/core/batch.ts`: the budget scheduler, driven by a `runRow` callback, using `money.ts`
- [ ] T079 [P] [US7] Create `src/cli/batch-file.ts` (CSV via `csv-parse/sync`, JSONL)
- [ ] T080 [US7] Create `src/cli/commands/batch.ts` (check `--budget`/`--no-budget`, Prepare every row that will run, price each, resume from the ledger, run the scheduler, build the report with `stopped`) and register it

**Checkpoint**: Story 7 scenarios and SC-008 pass.

---

## Phase 9: `regen`, `usage`, `models rank` (US9, US8, US10)

**Goal**: The three commands built on the ledger, pricing and catalog.

**Tests first**

- [ ] T081 [P] [US9] Write `tests/cli/regen.test.ts`: OpenRouter receives the original model, prompt, `settings` (with seed) and references exactly, and the new entry has `regen_of` (Story 9.1, FR-085); `--out` and `--force` follow `gen`'s rules, default the cwd; a missing local reference exits 2 naming it, with nothing sent (Story 9.2); a removed model exits 5; settings the model no longer supports exit 2 (FR-086); an entry without a seed re-runs with a warning on stderr that the result won't be identical; an unknown id exits 5
- [ ] T082 [P] [US8] Write `tests/cli/usage.test.ts` with `TZ` set (including a non-UTC zone): default last 30 days grouped by model (Story 8.1); `--since 2026-10-01 --by day` lists every day from that date, including empty days (Story 8.2); `7d`/`30d` spans; `--until` includes that whole day; `null` costs counted in `unknown_cost_count`, not as $0 (Story 8.3, FR-081); an invalid date exits 2
- [ ] T083 [P] [US10] Write `tests/cli/models-rank.test.ts`: only models that support every passed option and value and at least `--refs` references (Story 10.1, 10.2, FR-090); sorted by price for those options, `at_most` and `estimate` by their number, `unknown` last; JSON `{"settings", "models": [{"id", "name", "price"}]}`

**Implementation**

- [ ] T084 [P] [US9] Create `src/cli/commands/regen.ts` (reuses `generate.ts`) and register it
- [ ] T085 [P] [US8] Create `src/cli/commands/usage.ts` and register it
- [ ] T086 [P] [US10] Create `src/cli/commands/models-rank.ts` and register it as the `rank` subcommand of `models`

**Checkpoint**: Stories 8, 9 and 10 pass.

---

## Phase 10: `doctor`, `schema` and the whole interface (US11, US12, US2)

**Goal**: Self-checks, and a machine-readable description of every command that can't
drift from the code.

**Tests first**

- [ ] T087 [P] [US11] Write `tests/cli/doctor.test.ts`: a healthy setup passes every check and exits 0 (Story 11.1); each broken case (Node version and platform set through the context) fails or warns with a `fix`: Node older than 22.12, no key (and the key's source reported when there is one), rejected key, key limit under 10% remaining (warn), settings file readable by others (fail, exit 8; Story 11.2; on Windows `ok`, "not checked on Windows"), OpenRouter unreachable, catalog neither fresh nor refreshable, an unwritable folder, a ledger with skipped lines (warn with the count) (FR-095, FR-096); only one `GET /key` is made
- [ ] T088 [P] [US12] Write `tests/cli/schema.test.ts`: `schema` prints JSON with or without `--json`: the version, every command in `commands/index.ts` with its arguments and options (name, alias, type, allowed values, required, repeatable, description), each output as JSON Schema from `z.toJSONSchema()`, the error schema and the exit code table from `exit-codes.ts` (FR-098)
- [ ] T089 [US2] Write `tests/cli/agent-interface.test.ts` walking `commands/index.ts`: every command has `--help`; every command with `--json` in a failing case prints exactly one error object with the FR-040 exit code; no command prompts when stdin isn't a TTY (Story 2.3, SC-003)

**Implementation**

- [ ] T090 [P] [US11] Create `src/cli/commands/doctor.ts` (one small function per check) and register it
- [ ] T091 [P] [US12] Create `src/cli/commands/schema.ts` and register it

**Checkpoint**: all twelve commands exist and every story except US6 passes.

---

## Phase 11: Release (US6)

**Goal**: A package that installs from npm on three systems, with docs an agent can work
from.

**Tests first**

- [ ] T092 [US6] Write `tests/skill-md.test.ts`: `SKILL.md` mentions every command, every option and every exit code, read from the command definitions and `exit-codes.ts` (FR-045)

**Implementation**

- [ ] T093 [P] [US6] Add `LICENSE` (MIT, Kyle Neal, 2026) (FR-060)
- [ ] T094 [US6] Write `SKILL.md`: every command, option, JSON output shape and exit code, `csn` as the short form, `COSMION_MODEL`, `COSMION_HOME` (FR-057; not `COSMION_TEST_OPENROUTER_URL`, FR-058), and the agent rule for `batch`: always pass `--budget`, use `--no-budget` only when the user asks, and suggest it to the user rather than using it when a batch stops on an unknown cost; after a timeout, check openrouter.ai activity before trying again (FR-017); estimates match only the same settings, including the `--format` that `--out` implies (FR-034) (FR-044a, FR-045)
- [ ] T095 [P] [US6] Write `README.md`: install, a terminal example, an agent example, `csn`, the privacy sentence, the tip to set a spending limit on the key, `COSMION_HOME` and `COSMION_DEBUG` (FR-057, FR-059, FR-061). Its first line says what Cosmion does in search-friendly words (e.g. "generate images with any OpenRouter model from your terminal or your agent"), and `package.json` gets matching `keywords` (`openrouter`, `image-generation`, `cli`, `ai`, `agents`), since npm search reads them
- [ ] T096 [US6] Create `scripts/pack-check.mjs` and the `pack-check` script: `npm pack`, install the tarball in an empty temp folder, check both `cosmion` and `csn` exist, that the installed `package.json` has `engines.node: ">=22.12.0"` (Story 6.2) and that the install contains no `.node` files or install scripts (FR-060), run `cosmion --version` and `cosmion models --json` against the fake server via `COSMION_TEST_OPENROUTER_URL` with a temp `COSMION_HOME` (FR-063, Story 6.1). The fake is TypeScript; if a `.mjs` script can't start it simply, run the check as a Vitest file excluded from `npm test` instead and update the plan
- [ ] T097 [US6] Extend `.github/workflows/ci.yml`: pack-check on all three systems; on a `v*` tag, after all pass, `npm publish --provenance` with npm trusted publishing (FR-062)
- [ ] T098 [US6] Update `CLAUDE.md`'s project state (code now exists) and anything else a future session needs

**Manual checks by the maintainer** (they need real money, a real key or a fresh machine)

- [ ] T099 Set up npm trusted publishing for `cosmion` on npmjs.com, and give the GitHub repo the same description as the README's first line and topics such as `openrouter`, `image-generation`, `cli` and `ai-agents`
- [ ] T100 SC-002: generate with at least 5 per-image models and check every `exact` price equals the charged `usage.cost` (Riverflow excepted; after one generation `price` shows its last actual cost)
- [ ] T101 SC-001: from `npm install -g cosmion` to a saved image in under 2 minutes
- [ ] T102 SC-007: an agent given only `SKILL.md` and `--help` generates an image to a given path and reports its cost

**Checkpoint**: CI green on all three systems including pack-check; v0.1 ready to tag.

---

## Dependencies

- Phases run in order; each needs the ones before it.
- Phase 2 needs Phase 1. Phases 3–5 need Phase 2. Phase 4 needs Phase 3 (catalog,
  fixtures). Phase 5 needs only Phase 2 and could run before 3–4, but the order above is
  kept.
- Phase 6 (`gen`) needs Phases 3–5 (catalog, options, refs, ledger reading, key).
- Phase 7 needs Phase 6's ledger. Phase 8 needs Phase 6's `generate.ts` and Phase 4's
  pricing. Phase 9 needs Phases 4, 6 and 7. Phase 10 needs every command. Phase 11 needs
  all of them.
