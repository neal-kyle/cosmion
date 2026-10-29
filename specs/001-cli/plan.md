# Implementation Plan: Cosmion CLI

**Branch**: `001-cli` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Status**: Approved by the maintainer, 2026-10-18

How the v0.1 CLI in the spec is built. The spec says *what* it does (commands, flags,
JSON, exit codes); this says how, and why where the choice isn't obvious. OpenRouter
details are in `docs/openrouter-api.md` and aren't repeated.

## Summary

One npm package, `cosmion`, written in TypeScript and compiled to plain JavaScript for
Node 22.12+. `src/core` holds the logic (OpenRouter client, catalog, option validation,
pricing, the batch budget), `src/cli` the interface (commands, output, the ledger, the
caches, saving files). Every command is described once, as data, and that one
description drives option parsing, `--help`, `--json` output validation and
`cosmion schema`. Tests run each command in-process against a fake OpenRouter and a
temporary folder.

## Technical context

| | |
|---|---|
| **Language** | TypeScript (strict), compiled with `tsc` to ES modules in `dist/`. No bundler: the package ships `dist/` and installs its dependencies like any npm package |
| **Runtime** | Node **22.12+** (`engines: ">=22.12.0"`). Uses built-in `fetch`, `AbortController`, `crypto.randomInt`, `util.styleText` |
| **Runtime dependencies** | `commander`, `zod`, `env-paths`, `csv-parse`, `image-size` (reasons below) |
| **Dev dependencies** | `typescript`, `vitest`, `@biomejs/biome`, `@types/node@22` (pinned to 22 so code can't use APIs newer Node versions added) |
| **Storage** | JSON files only: settings file (key), catalog cache, ledger (JSON Lines). No database |
| **Testing** | Vitest; fake OpenRouter; temporary `COSMION_HOME` per test |
| **Platforms** | Linux, macOS, Windows (CI runs all three) |
| **Scale** | ~61 image models; ledgers up to tens of thousands of entries (`history`/`show` < 1 s at 10,000, SC-005) |

### Dependencies and why each beats our own code

| Package | Used for | Why not our own code |
|---------|----------|----------------------|
| `commander` | Parsing commands, subcommands (`models rank`, `auth status`) and options; `--help`; `--version` | Subcommands, aliases, repeatable options and help text are a few hundred lines to get right. Widely used, no dependencies. Its current major needs Node 22.12, hence the engines floor |
| `zod` (v4) | Validating OpenRouter responses where they enter (FR-056), ledger lines, settings and batch rows; defining every `--json` output; `z.toJSONSchema()` produces `cosmion schema`'s output schemas | One definition gives both the runtime check and the published JSON Schema, so they can't drift (FR-099) |
| `env-paths` | The per-OS config, data and cache folders (already settled) | The right folder differs per OS (XDG on Linux, `Library/` on macOS, `%APPDATA%`/`%LOCALAPPDATA%` on Windows). **Gotcha:** it appends `-nodejs` by default, so call it as `envPaths('cosmion-cli', { suffix: '' })` |
| `csv-parse` | Reading batch CSV files (`csv-parse/sync`) | Prompts contain commas, quotes and sometimes newlines; spreadsheet exports add a byte-order mark and CRLF line endings. A correct CSV reader isn't "a few lines" |
| `image-size` | Width, height and type from image bytes: dimensions for the ledger, and checking a `--ref` file really is PNG, JPEG or WebP | PNG is easy, but JPEG and the three WebP layouts each need their own header parsing. Pure JS, no dependencies |

Not used: the `@openrouter/sdk` (plain `fetch` covers the five endpoints, as
`docs/openrouter-api.md` says), a prompt library (hidden key input is ~25 lines of raw
stdin), a color library (`util.styleText`), a spinner library (~15 lines).

## Architecture

```
src/core   logic: no printing, no process.exit, no imports from src/cli
src/cli    interface: commands, output, ledger, caches, settings location, saving images
```

- `core` never imports from `cli`, never prints and never exits (constitution VI). A test
  reads every file under `src/core` and fails on an import from `../cli`, `console.`,
  `process.exit` or `process.stdout`/`stderr`.
- Where data lives is the CLI's business (constitution VI, "data per product"): the
  ledger, catalog cache and settings *location* are in `cli`. `core` gets the data it
  needs passed in: pricing receives "the last matching generation's tokens and cost",
  not a ledger.
- Plain functions and modules. One error class, no other classes.

### Source layout

```text
src/
├── core/
│   ├── errors.ts          CosmionError { code, message, retryable } and the error codes
│   ├── money.ts           USD ↔ integer nano-dollars; sums and comparisons
│   ├── ids.ts             8-char lowercase id generator
│   ├── openrouter.ts      HTTP client: images, image models, endpoints, key, credits;
│   │                      HTTP status → CosmionError; zod-validated responses
│   ├── catalog.ts         Build the catalog (models + endpoint records) from the client;
│   │                      look up a model; references accepted / max
│   ├── options.ts         Gen options ↔ API fields; validate against supported_parameters;
│   │                      "same settings" key; random seed
│   ├── pricing.ts         price(model, settings, refCount, lastMatch) → PriceResult
│   ├── batch.ts           Budget scheduler: which row starts when (FR-073), via callbacks
│   └── settings-file.ts   Read/write a JSON file with owner-only permissions
└── cli/
    ├── main.ts            Entry point (#!/usr/bin/env node): real context → run() → exit code
    ├── run.ts             Build commander from command definitions; parse; run; print;
    │                      map errors to exit codes
    ├── context.ts         The Context type (see Testing seams)
    ├── name.ts            The tool's name, once (see Paths and test hooks)
    ├── paths.ts           Config, data and cache folders (env-paths or COSMION_HOME)
    ├── exit-codes.ts      The FR-040 table, once (used by run.ts and schema)
    ├── output.ts          JSON/text printing, stderr warnings, colors, spinner,
    │                      formatUsd, key redaction
    ├── define.ts          defineCommand() and the option-definition type
    ├── gen-options.ts     Option definitions shared by gen, price, models rank, batch
    ├── key.ts             Which key is in use: env var, then settings file
    ├── hidden-input.ts    Read a line from a TTY without echoing it
    ├── catalog-cache.ts   Load the cached catalog; refresh when stale, missing or asked
    ├── ledger.ts          Entry schema; append; read (skipping bad lines); find
    ├── generate.ts        The gen pipeline shared by gen, regen and batch rows
    ├── out-paths.ts       Where images go (FR-007, FR-008, FR-011)
    ├── refs.ts            Read and check --ref files and URLs
    ├── batch-file.ts      Parse a CSV/JSONL batch file into rows
    └── commands/
        ├── index.ts       The list of all command definitions
        ├── gen.ts  price.ts  models.ts  models-rank.ts  history.ts  show.ts
        ├── auth.ts        auth, auth status, auth logout
        ├── batch.ts  usage.ts  regen.ts  doctor.ts  schema.ts
tests/
├── helpers/
│   ├── fake-openrouter.ts A fake that answers like OpenRouter, as a fetch function and
│   │                      (for multi-process tests) as a local HTTP server
│   ├── run-cli.ts         Run a command in-process with a temp COSMION_HOME and cwd
│   ├── fixtures/          Catalog fixtures (one model per pricing case), tiny images
│   └── setup.ts           Replaces the global fetch with one that throws (SC-004)
├── core/                  Unit tests: openrouter, options, pricing, money, ids,
│                          settings-file, batch scheduler
├── cli/                   One file per command, plus run, agent-interface, ledger,
│                          out-paths, refs, batch-file, paths, format-usd
├── boundary.test.ts       core/cli import rule
├── skill-md.test.ts       SKILL.md mentions every command, option and exit code
└── concurrency.test.ts    20 real processes appending to one ledger (SC-006)
scripts/pack-check.mjs     npm pack → install in empty folder → run against the fake
SKILL.md  README.md  LICENSE  package.json  tsconfig.json  tsconfig.build.json
biome.json  vitest.config.ts  .gitattributes
.github/workflows/ci.yml
```

## Design decisions

### Commands are defined once, as data (FR-098, FR-099)

Each `commands/*.ts` exports one definition:

```ts
export const price = defineCommand({
  name: 'price',
  summary: 'Show what a generation will cost, without spending',
  options: [modelOption, ...genOptions],   // name, flag, alias, type, values, required,
                                           // repeatable, description
  output: PriceResultSchema,               // zod schema of the --json result
  async run(input, ctx) { … return { data } },          // or { data, exitCode: 8 }
  text(data) { return `≤$0.09  …` },        // stdout in text mode
})
```

- `run.ts` turns the list into a commander program, adds `--json` to every command, and
  converts option values by their declared type (an integer that isn't one exits 2).
- A definition can have `subcommands`, each a definition of its own. A parent can also
  have its own `run` and arguments: `auth` saves a key while `auth status` and
  `auth logout` are its children, and `models [id]` lists or shows while `models rank` is
  its child (model ids contain a `/`, so none is mistaken for `rank`).
- `schema` walks the same list: options straight from the definitions, outputs via
  `z.toJSONSchema()`, exit codes from `exit-codes.ts`. It always prints JSON.
- The test helper validates every `--json` result against its command's `output` schema
  on every test run, so SC-003 and FR-099 are checked by all command tests, not one.
- Commander is set up not to exit or print by itself (`exitOverride`, `configureOutput`):
  its parse errors become `usage` errors (exit 2), printed as JSON when `--json` is in
  the arguments. `--help` and `--version` print to stdout and exit 0.

### Output and errors (FR-040–FR-043)

- Commands return data; they don't print results. `run.ts` prints exactly one JSON object
  with `--json`, otherwise `text(data)`. Warnings and progress go through `ctx.warn()` /
  a spinner on stderr; the spinner and colors appear only when stderr is a TTY and
  `NO_COLOR` is unset.
- `core` throws `CosmionError` with a code from FR-040 (`usage`, `auth`, `credits`,
  `not_found`, `rate_limited`, `upstream`) and its `retryable` flag (the timeout is the
  one `upstream` error that isn't retryable); `run.ts` maps it through
  `exit-codes.ts` and prints `{"error": {"code", "message", "retryable"}}`. Anything else
  thrown is `internal`, exit 1, with a one-line message (stack trace only with
  `COSMION_DEBUG=1`, on stderr; FR-059).
- HTTP status mapping lives in `openrouter.ts` (the table in `docs/openrouter-api.md`);
  a `fetch` that throws (offline, DNS) is `upstream`, retryable. For 402 the message
  names `metadata.limit_source` and the credits link (FR-040a).
- **Key never printed (FR-049):** besides never formatting it, `output.ts` replaces the
  key, if it occurs, in every message before writing it. Belt and braces for an error
  body that echoes a header.
- Exit 8 isn't an error: `batch` and `doctor` return their normal result with
  `exitCode: 8`. A `batch` stopped by an auth or credits error returns its report with
  `exitCode: 3` or `4` (FR-078).
- Exit 130 (Ctrl-C) prints nothing on stdout, even with `--json`; the message goes to
  stderr (FR-041).
- **Prices in text** (`formatUsd`, FR-037): under $1, three significant figures without
  trailing zeros; $1 or more, two decimals.

### Money: integer nano-dollars

Floating-point arithmetic goes wrong exactly where budgets are compared: in JavaScript
`0.2 − 0.04 − 0.04 − 0.04 − 0.04` is `0.03999999999999999`, so the fifth $0.04 row of
Story 7's first scenario would wrongly be skipped. `money.ts` converts USD to whole nano-dollars
(`Math.round(usd × 1e9)`) for every sum and comparison in pricing and the budget, and
back to USD for output. Nano, not micro, because per-token prices go below a millionth
of a dollar. The ledger and JSON keep plain USD numbers.

### Catalog and its cache (FR-020–FR-022)

- A refresh is `GET /images/models` plus one `GET …/endpoints` per model (~62 requests),
  at most 8 at a time. No key is sent. If any request fails, the refresh failed: use the
  stale cache with a warning, or exit 7 with no cache (spec edge cases).
- Stored as one `catalog.json` in the cache folder with `fetched_at`. Written to a
  temporary file and renamed, so a process reading it never sees half a file.
- An unknown model triggers one refresh, then exits 5.
- Options are validated against the model-level `supported_parameters` (FR-005); prices
  come from each endpoint's lines.

### Options and "same settings" (FR-003–FR-005, FR-034)

- `gen-options.ts` defines the nine gen options once (flag, API field, type); `gen`,
  `price`, `models rank` and batch columns all use it.
- `core/options.ts` checks each passed option against the model's descriptor: absent key
  → not supported; `enum` → listed values; `range` → integer in range. The message lists
  the allowed values.
- Random seed (FR-004): within the model's `seed` range if it has one, otherwise
  0–2,147,483,647.
- **Same settings**, used for estimates and for batch groups: the sent `settings` minus
  `seed`, plus the number of references, as a canonical key (sorted JSON). The ledger
  stores `settings` with API field names, so a new request and an old entry compare
  directly. The `output_format` implied by `--out` is part of the sent settings, so
  `price` matches such an entry only with the same `--format`; `SKILL.md` says so.

### Pricing (FR-030–FR-037)

`price(model, { settings, refCount }, lastMatch)` is a pure function. `lastMatch` is
`{ usage, cost_usd } | null`, found by the CLI in the ledger (newest entry with the same
model and same settings). For each endpoint it picks the output line (FR-032), adds
reference lines (FR-033), applies the unit rules (`image` exact, `token` and `megapixel`
from `lastMatch`, unknown unit → unknown), multiplies per-image catalog lines by `n`
(never an estimate: `lastMatch` had the same `n` and its cost already covers the whole
request), then combines endpoints: equal → that kind, different → `at_most` with the
highest. `models` prices each model this way with no options. Every
case in Story 4 and every pricing case in `docs/openrouter-api.md` → Charged vs listed
gets a fixture model and a test.

Combining kinds (several endpoints, the batch dry-run total): from strongest to weakest,
`exact` → `at_most` → `estimate` → `unknown`; a combination takes the weakest. A dry-run
total with any `unknown` row is `unknown`, `cost_usd: null`, and its `notes` give the
subtotal of the known rows and how many are unknown.

### Generating: one pipeline for gen, regen and batch rows

`generate.ts` has two steps, so `batch` can check every row before spending anything:

1. **Prepare** (no network except a possible catalog refresh, no writes): pick the ledger
   id, find the model, validate options, add a random seed, read refs into data URLs, add
   the `output_format` implied by `--out` (FR-009), resolve output paths and check them
   (FR-012). Returns a ready request.
2. **Execute**: create missing parent folders, `POST /images` with a 5-minute timeout,
   decode each `b64_json`, write each file, append one ledger entry, return it.

Details:

- **Output paths:** the id is generated before the request, so default names
  (`cosmion-<id>.<ext>`) are known except for the extension, which comes from `media_type`.
  The pre-check refuses if `cosmion-<id>` already exists with any of the four extensions.
  For a folder that doesn't exist yet, it checks that the nearest existing folder above it
  is writable; the missing folders are created in Execute, so `price`, a `batch --dry-run`
  or a batch refused for a bad row leaves nothing behind (an empty folder left by a failed
  request is harmless). `--out hero` with no extension writes `hero` exactly, as FR-008
  says. A trailing `/` or `\` (Windows) marks a folder.
- **No overwrite race:** files are written with the exclusive-create flag (`wx`) unless
  `--force`, so a file that appears between the check and the write is still not
  overwritten (that case becomes "paid but not saved").
- **Refs:** a local file is read and its type taken from its bytes (`image-size`), not its
  extension; PNG, JPEG and WebP only. `https://` URLs are sent as they are. The ledger
  stores absolute paths and URLs.
- **Dimensions:** read with `image-size`; `null` for SVG. If a saved image's dimensions
  can't be read, the file is kept, dimensions are `null` and a warning is printed. Only a
  failure to decode or write the file counts as "paid but not saved" (ledger entry with
  no images, exit 1).
- **No images returned:** an empty `data` list isn't a malformed response: the entry is
  written with the cost and no images, then the command exits 7, not retryable.
- **Provider and generation id** from the `x-provider-name` and `x-generation-id`
  headers. `X-OpenRouter-Title: Cosmion` on every request (FR-055); `HTTP-Referer` is added
  once there's a public URL.
- **Ctrl-C:** `main.ts` turns SIGINT into an `AbortSignal` in the context. An aborted
  generation writes no ledger entry and prints the "may still have been charged" message.
  It exits 130 (FR-040).
- **Timeout:** an `AbortController` aborted by a plain `setTimeout` (not
  `AbortSignal.timeout`, which Vitest's fake timers don't control), combined with the
  context's signal. The abort reason tells them apart: a timeout is `upstream`,
  `retryable: false`, exit 7, with the same "may still have been charged" message
  (FR-017); Ctrl-C exits 130.

### Ledger (FR-050–FR-054)

- `ledger.jsonl` in the data folder. **Append:** open with the `a` flag, write the whole
  line (entry + `\n`) in one `write` call, close. With append mode each write lands at
  the end of the file as one piece on Linux, macOS and Windows; entries are ~1 KB. The
  concurrency test spawns 20 real processes to prove it (SC-006).
- **Read:** read the whole file, split lines, parse each with the zod entry schema; skip
  (with a stderr warning) lines that don't parse or have an unknown `v` (FR-052). The
  schema passes unknown fields through. 10,000 entries is ~10 MB, well under a second.
- **Ids:** 8 characters from `a–z0–9` via `crypto.randomInt`, regenerated if the id is
  already in the ledger. Batch ids are made the same way.
- The entry schema is also `gen`'s and `regen`'s output schema, and `history`/`show`
  build on it.

### Key and settings (FR-046–FR-049)

- `settings.json` in the config folder: `{ "api_key": "…" }`. `settings-file.ts` writes a
  temporary file with mode `0600`, sets `0600` again explicitly (mode only applies at
  creation), then renames it into place. On Windows the mode is ignored; the file is in
  the user's own profile.
- Key resolution: `OPENROUTER_API_KEY`, else the file. `auth` warns when the env var is set.
- Hidden input: raw-mode stdin on a TTY, no echo, Enter to finish, Backspace and Ctrl-C
  handled. Without a TTY and without `--stdin`, exit 2 before reading anything.
- `auth status` with a rejected key reports `valid: false`, and with no key
  `source: "none"`; both exit 0, since the command itself worked. A network failure exits
  7 (FR-048).

### Batch (FR-070–FR-078)

Split into the pure money logic and the CLI around it:

- `batch-file.ts` parses CSV (header row, `|`-separated refs) or JSONL (refs as an array)
  into rows; unknown columns, a missing `prompt`, or a bad value are reported with the
  row number.
- `batch.ts` (command): resolves each row with `--model`/`COSMION_MODEL` as default, runs
  **Prepare** on every row that will run, and exits 2 listing every bad row, including
  two rows writing the same path (FR-072). Each row is priced as `price` would.
- **`--budget` and `--no-budget` are two separate options** in the command definition.
  Commander would otherwise read `--no-budget` as "turn `--budget` off" and let the last
  one win, so the command checks that exactly one was given and that the budget is a
  number above 0 (FR-071). With `--dry-run` neither is required and both are ignored.
- The report's `stopped` is `null`, or `{ code, message }` when a `credits`/`auth` error
  or an unknown cost (`unknown_cost`) stopped new rows; the same message goes to stderr.
- `core/batch.ts` (scheduler): given rows with prices, a budget, what's already spent, a
  concurrency and a `runRow` callback, decides what starts when:
  - Rows are taken **in file order**. A known-price row starts when its price fits in
    budget − spent − prices of running rows. If it doesn't fit and rows are running, wait
    for one to finish and check again; if nothing is running, it can never fit:
    `skipped_budget`, move on to the next row.
  - An `unknown`-price row waits until nothing is running, then starts alone if
    spent < budget. When it finishes, its actual cost becomes the price of the remaining
    rows in its group (same model and same settings, so the same count: a price per row).
  - Any finished row whose actual cost is higher than its group's price raises that
    price to the actual cost (the catalog can list less than is charged). Prices are
    never lowered.
  - Spending is the sum of finished rows' actual costs. A `credits` or `auth` error stops
    new rows; running ones finish; the rest are `not_run`.
  - A finished row with no `usage.cost` counts its price if it had one; if not, no new
    rows start and the rest are `not_run` (FR-073a).
  - With `--no-budget` the budget is `null` and a row starts as soon as a slot is free.
  - It never touches files or the ledger; the callback does. That keeps it fast to test
    with fake rows and fake timings, including SC-008's "never over budget" checks.
- **Resume** (FR-076): a row is done if the ledger has an entry for that `batch_id` and
  `row` **with at least one saved image** (so a paid-but-not-saved row is retried). Done
  rows are `skipped_resumed` and not validated again (their output files now exist).
  Every earlier entry of the batch, done or not, counts toward spending, and its actual
  cost sets its group's price as above. An earlier entry
  with no cost counts its row's price; if that's unknown and `--budget` is given, exit 2
  pointing to `--no-budget` (FR-073a).
- `--no-budget` prints its warning on stderr before any row starts.
- Paths in the batch file (`out`, `ref`) are relative to the current folder, like `gen`.
- Text mode prints the batch id on stderr at the start, so an interrupted run can be
  resumed.

### Usage (FR-080–FR-082)

- `--since`/`--until` take `YYYY-MM-DD` (local midnight; `--until` includes that whole
  day) or `<n>d` (n days before now). Default: the last 30 days up to now.
- `--by day` lists every calendar day in the range, including days with nothing (zeros),
  in local time. `--by model` lists only models with entries.
- Tests set `TZ` explicitly, including one non-UTC zone, so day boundaries are checked.

### Doctor (FR-095)

Each check is a small function returning `{ name, status, message, fix }`, run in order.
Network checks share one `GET /key`. The permission check is skipped (`ok`, "not checked
on Windows") on Windows. The Node version and platform come from the context, so tests
can check an old Node and the Windows branch on any machine.

### Paths and test hooks

- **The name lives in one place,** `src/cli/name.ts`. The folder name (`cosmion-cli`), the
  environment variable prefix (`COSMION_`), the default file prefix (`cosmion-<id>`) and
  the `X-OpenRouter-Title` header (passed into the `core` client) all read from it, so a
  rename before release is mostly one line. Four real uses, so it isn't premature.
- Folders come from `env-paths('cosmion-cli', { suffix: '' })`.
- Two environment variables let a separate process be pointed at a temp folder and a
  fake, which the tests that run the real installed binary need (the packaging check,
  FR-063; 20 concurrent processes, SC-006):
  - `COSMION_HOME=<dir>` puts `config/`, `data/` and `cache/` under one folder (FR-057).
    A real feature, documented in the README and `SKILL.md`.
  - `COSMION_TEST_OPENROUTER_URL` replaces `https://openrouter.ai/api/v1` (FR-058).
    Test-only: mentioned in `CLAUDE.md`, not in user docs.

## Testing

Test-first per constitution IV. Strict for `src/core`, the ledger, every command's
behavior (`--json` output, exit codes, files written) and the batch budget.

- **Testing seams** (the only things passed in, constitution II): every command gets a
  `Context`: `env`, `cwd`, `stdin`/`stdout`/`stderr` (with their TTY flags), `fetch`, the
  OpenRouter base URL (from `COSMION_TEST_OPENROUTER_URL` in `main.ts`, otherwise the real
  one), an `AbortSignal`, and `platform` and `nodeVersion` (for `doctor` and the
  permission checks). Folders come from `COSMION_HOME` in `env`, so the ledger, cache and
  settings file are swapped by pointing at a temp folder. `cwd` is in the context because
  tests can't safely change the process's folder.
- **`runCli(args, options)`** creates a temp `COSMION_HOME` and cwd, runs the command
  in-process with the fake, and returns `{ exitCode, stdout, stderr, json }`. With
  `--json` it checks stdout is exactly one JSON object matching the command's schema.
- **Fake OpenRouter:** a `fetch`-compatible function serving catalog fixtures, `/key`,
  `/credits` and `/images` (configurable per test: images returned, `usage.cost`, headers,
  error status, delay), and recording every request so tests can assert what was sent
  (e.g. `regen` sends exactly the original request; nothing is sent when validation
  fails). The same handler behind a `node:http` server on a random port serves the two
  multi-process tests.
- **Fixtures:** small hand-written catalog JSON with one model per case: single
  per-image line, tiered variants, variant-less + `high_resolution`, two providers at
  different prices, per-token, per-megapixel, no pricing, unknown unit, `unit: request`
  refs, SVG output. Real model ids and figures from `docs/openrouter-api.md` where they
  exist.
- **Interactive input** (`auth` on a TTY): behavior only, with a fake TTY stdin.
- Permission tests are skipped on Windows. Nothing reaches the network or the user's
  folders (SC-004): the fake is the only `fetch` command tests get, the global `fetch` is
  replaced with one that throws (`tests/helpers/setup.ts`), and `vitest.config.ts` sets
  `COSMION_HOME` to a temp folder for anything that slips through.
- `runCli` accepts an empty stdout only for exit 130.
- The SC-005 timing test builds its 10,000-entry ledger before the timer starts.

## Build, run and release

| Command | Does |
|---------|------|
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` (`tsconfig.json` type-checks source and tests for lint) |
| `npm test` | Builds first (`pretest`, because the concurrency test runs `dist/`), then Vitest (all tests) |
| `npm run lint` | Biome lint + format check, and `tsc --noEmit` |
| `npm run format` | Biome formats the code |
| `node dist/cli/main.js …` (or `npm link` once, then `cosmion …`) | Run the built CLI locally |
| `npm run pack-check` | `scripts/pack-check.mjs` (FR-063) |

- `package.json`: `name: "cosmion"`, `type: "module"`,
  `bin: { "cosmion": "dist/cli/main.js", "csn": "dist/cli/main.js" }` (FR-044a),
  `files: ["dist", "SKILL.md"]` (npm adds README and LICENSE), `license: "MIT"`,
  `engines.node: ">=22.12.0"`. The version is read at runtime from `package.json`.
- **CI** (`.github/workflows/ci.yml`): on every push, on Ubuntu, macOS and Windows with
  Node 22: install, lint, test, build, pack-check. On a `v*` tag, after those pass on all
  three: `npm publish` with npm's trusted publishing (GitHub's OIDC, no stored token;
  set up once on npmjs.com) and provenance, once a check confirms the tag is `v` plus
  `package.json`'s version. `prepack` builds, so a pack or publish always ships a fresh
  `dist/`.
- **pack-check** is `.mjs` and imports the TypeScript fake directly, with Node's
  `--experimental-strip-types` (built in since 22.6), so it needs no build step of its own.
- **npm name:** `cosmion` has never been published (checked 2026-10-18), and the `csn`
  package installs no command, so neither command clashes. Worth publishing a placeholder
  early to hold the name. Before launch, search USPTO, EUIPO and CIPC for "COSMION" in
  classes 9 and 42.

## Build order (for `/speckit-tasks`)

Each phase leaves the CLI working and tested:

1. Scaffold: package, TypeScript, Biome, Vitest, CI, the boundary test.
2. Agent interface skeleton: `define.ts`, `run.ts`, output, errors and exit codes,
   `--json`, `--version`, `--help`, and `runCli`.
3. Catalog + `models`, `models <id>`, with the fake OpenRouter and its fixtures.
4. Options and pricing + `price` (US4), with ledger reading (for estimates) and refs.
5. Key: `auth`, `auth status`, `auth logout` (US3).
6. Ledger + `gen` (US1, US2).
7. `history`, `show` (US5).
8. `batch` (US7).
9. `regen` (US9), `usage` (US8), `models rank` (US10).
10. `doctor` (US11), `schema` (US12).
11. Release: `SKILL.md`, README, LICENSE, pack-check, tag publishing (US6).

## Constitution check

| Principle | How the plan meets it |
|-----------|-----------------------|
| I. Simplest thing | No bundler, no database, five small runtime dependencies each replacing real work. Shared helpers only with 2+ users: `gen-options` (4), `generate` (3), `money` (pricing + batch) |
| II. SOLID, proportionately | One job per file. Passed in: `fetch` (the OpenRouter client), folders (ledger, cache, settings), streams. Plain functions; one error class |
| III. One maintainer | Commands are one file each in the same shape; this plan gives reasons for each choice |
| IV. Test-first | Strict where the spec says; every `--json` result schema-checked in every command test; fakes and temp folders only |
| V. Agent interface | Exit codes in one table; JSON results validated against the published schema; prompts only on a TTY |
| VI. Logic apart | `core` is pure logic, enforced by a test; data locations live in `cli` |

**Complexity to justify:** `COSMION_TEST_OPENROUTER_URL`, which no user asked for. The
packaging check and the concurrency test have to run the real binary against a fake, and
there's no other way to point a separate process there. (`COSMION_HOME` is needed for the
same reason, but is also an ordinary feature.)

## Open questions for the maintainer

None. The four found while planning were decided on 2026-10-18 and are in the spec's
clarifications: a batch row with no `usage.cost` and `--no-budget` (FR-071, FR-073a);
Ctrl-C exits 130 (FR-040); `COSMION_HOME` documented and the test-only
`COSMION_TEST_OPENROUTER_URL` (FR-057, FR-058); Node 22.12+ (FR-060). The five raised
by `/speckit-analyze` the same day are there too: batch prices raised by actual costs and
the one-row bound (FR-073, SC-008), the timeout not retryable (FR-017), no `partial`
error code (FR-040), and `--dry-run` without a budget (FR-071).
