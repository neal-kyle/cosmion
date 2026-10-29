---
name: cosmion
description: Generate images with any image model on OpenRouter from the command line, save them to files, check prices before spending, and track what was spent. Use when asked to generate, create or edit an image with an AI model, compare image model prices, or run many image prompts within a budget.
---

# Cosmion

`cosmion` is a CLI that generates images with any image model on OpenRouter, using the
user's own OpenRouter key. `csn` is the short form: `csn gen …` is `cosmion gen …`.

It needs Node 22.12 or newer. Install it with `npm install -g cosmion`.

## Rules for agents

- Pass `--json` to every command. stdout is then exactly one JSON object; logs,
  progress and warnings go to stderr. Read the exit code (see [Exit codes](#exit-codes)).
- Never prompt: Cosmion doesn't ask questions when stdin isn't a terminal. Anything it
  would need to ask exits 2 with a message saying what to pass instead.
- Check the price first when cost matters: `cosmion price` spends nothing.
- `gen` and `regen` are never retried automatically, because a retry can be charged
  twice. After an `upstream` error that isn't retryable (Cosmion's own 5-minute timeout),
  tell the user to check their activity on openrouter.ai before trying again: the
  provider may already have charged.
- For `batch`, always pass `--budget` with a dollar amount. Use `--no-budget` only when the user asks
  for it. If a batch stops because a cost is unknown, tell the user and suggest the
  `--no-budget --resume` command from the message rather than running it yourself.
- `cosmion schema` prints every command, option, JSON output (as JSON Schema) and exit
  code as one JSON object, generated from the code itself.

## Setup

The key comes from `OPENROUTER_API_KEY` if set, otherwise from the one saved with
`cosmion auth`. Check with `cosmion auth status --json` or `cosmion doctor --json`.

Environment variables:

| Variable | Does |
|----------|------|
| `OPENROUTER_API_KEY` | The OpenRouter key; used instead of the saved one while set |
| `COSMION_MODEL` | The model when `--model` isn't passed (`gen`, `price`, `batch`) |
| `COSMION_HOME` | Keep all of Cosmion's files (settings, history, catalog cache) under this folder instead of the usual per-OS folders |
| `COSMION_DEBUG` | `1` adds the stack trace of an unexpected error (exit 1) to stderr |
| `NO_COLOR` | Turns off colors on stderr |

## Commands

### Gen options

Shared by `gen`, `price`, `models rank` and the `batch` columns. Only the
options passed are sent; the rest use the model's defaults. Each is checked against what
the model supports, and a value it doesn't support exits 2 listing the allowed values
(see `cosmion models <id>`):

| Option | Sends | Value |
|--------|-------|-------|
| `--aspect <ratio>` | `aspect_ratio` | e.g. `16:9` |
| `--resolution <r>` | `resolution` | e.g. `1K`, `2K`, `4K` |
| `--quality <q>` | `quality` | e.g. `low`, `medium`, `high` |
| `--background <b>` | `background` | `auto`, `transparent` or `opaque` |
| `-n, --count <n>` | `n` | how many images to ask for (an upper bound) |
| `--seed <int>` | `seed` | for repeatable results; `gen` picks and records one when the model supports it |
| `--format <f>` | `output_format` | `png`, `jpeg`, `webp` or `svg` |
| `--compression <0-100>` | `output_compression` | for jpeg and webp |
| `--ref <path-or-url>` | `input_references` | a PNG, JPEG or WebP file or an `https://` URL; repeatable |

### `cosmion gen <prompt>`

Generates images, saves them and records the generation in the history. `<prompt>` is
the text, or `-` to read it from stdin.

Options: `-m, --model <id>` (default `COSMION_MODEL`), the gen options above,
`--out <path>`, `--force`, `--json`.

- Without `--out`, images go in the current folder as `cosmion-<id>.<ext>`, or
  `cosmion-<id>-<k>.<ext>` when there are several.
- `--out <path>` is a folder if it exists as one or ends with `/`; otherwise it is the
  exact file to write (`<stem>-<k><ext>` for several images). An `--out` ending in an
  image extension also asks the model for that format when `--format` isn't given.
- Existing files are never replaced unless `--force` is passed.
- Everything is checked (key, model, options, references, output paths) before anything
  is sent or spent.

`--json` prints the history entry:

```json
{
  "v": 1,
  "id": "k3f9x2ab",
  "created_at": "2026-10-17T14:03:11.204Z",
  "model": "bytedance-seed/seedream-4.5",
  "prompt": "a lighthouse at dusk",
  "settings": { "aspect_ratio": "16:9", "resolution": "2K", "seed": 1234 },
  "references": [],
  "images": [
    { "path": "/home/me/site/cosmion-k3f9x2ab.jpg", "width": 2560, "height": 1440, "format": "jpeg" }
  ],
  "cost_usd": 0.04,
  "usage": { "prompt_tokens": 17, "completion_tokens": 16384, "total_tokens": 16401 },
  "provider": "Seed",
  "generation_id": "gen-img-…",
  "batch_id": null,
  "row": null,
  "regen_of": null
}
```

`cost_usd` is what OpenRouter charged, or `null` when it didn't say. Paths are absolute.

Text mode prints the saved paths on stdout, one per line.

### `cosmion price`

Shows what a generation would cost, without spending anything or needing a key.

Options: `-m, --model <id>`, the gen options above, `--json`.

```json
{ "model": "…", "settings": { "resolution": "2K" }, "kind": "exact", "cost_usd": 0.04, "notes": [] }
```

`kind` is one of:

- `exact`: the listed price.
- `at_most`: a ceiling (providers at different prices, or a tier that can't be told
  apart).
- `estimate`: from the last generation with the same model and the same settings in the
  history. Same settings means every option sent except the prompt and seed, including
  the number of references and the format that `gen --out x.png` implies; so
  `price --format png` matches an earlier `gen --out x.png`, and `price` without
  `--format` doesn't.
- `unknown`: `cost_usd` is `null`; nothing is guessed. Generate once and `price` can then
  estimate it.

`notes` explains anything not counted.

### `cosmion models [id]`

Lists every image model, or shows one in full.

Options: `--refresh` (fetch the catalog again; it is otherwise cached for 24 hours),
`--json`.

- List: `{"models": [{"id", "name", "accepts_references", "max_references", "parameters", "price"}], "fetched_at"}`.
- One model: `{"id", "name", "description", "parameters", "endpoints": [{"provider_name", "provider_tag", "supported_parameters", "pricing"}], "fetched_at"}`. `parameters` lists the options it supports and their allowed values.

`price` is `{"kind", "cost_usd", "notes"}`, as `cosmion price` gives it.

### `cosmion models rank`

Lists the models that support every option passed, cheapest first (`unknown` prices
last).

Options: the gen options above except `--ref`, `--refs <n>` (models must accept at least
this many references), `--json`.

`{"settings", "models": [{"id", "name", "price"}]}`

### `cosmion batch <file>`

Generates every row of a `.csv` (with a header row) or `.jsonl` file, within a budget.
Columns: `prompt` (required), `model` (required unless `--model` or `COSMION_MODEL` is
set), `aspect`, `resolution`, `quality`, `background`, `count`, `seed`, `format`,
`compression`, `ref` (several separated by `|` in CSV, an array in JSONL), `out`. Unknown
columns exit 2.

Options:

- `--budget <usd>`: the most this run may spend. Always pass it.
- `--no-budget`: no cap except the key's own spending limit. Only when the user asks.
- `-m, --model <id>`: the model for rows without one.
- `--out <folder>`: the folder for rows without an `out`.
- `--concurrency <n>`: rows at once, 1 to 8 (default 2).
- `--force`: replace files that already exist.
- `--dry-run`: check every row and show prices, spending nothing (no budget needed).
- `--resume <batch-id>`: continue a batch; rows already saved are skipped and its earlier
  spending counts against `--budget`.
- `--json`.

Every row is checked before anything is spent; any bad row exits 2 listing each bad row.
A row starts only if its price fits in what's left of the budget. Rows are never
retried. A failed row doesn't stop the others; an `auth` or `credits` error stops new
rows from starting.

```json
{
  "batch_id": "…", "budget_usd": 0.2, "spent_usd": 0.08,
  "stopped": null,
  "rows": [{ "row": 1, "status": "ok", "id": "…", "paths": ["…"], "cost_usd": 0.04, "price": { "kind": "exact", "cost_usd": 0.04, "notes": [] }, "error": null }]
}
```

- `budget_usd` is `null` with `--no-budget`.
- `status` is `ok`, `failed`, `skipped_budget`, `skipped_resumed` or `not_run`.
- `stopped` is `null`, or `{"code", "message"}` when the batch stopped early. Code
  `unknown_cost` means a row's cost couldn't be known, so the budget couldn't be tracked;
  the message gives the `--no-budget --resume` command to continue, which is the user's
  call.
- With `--dry-run`: `{"rows": [{"row", "price"}], "total": <price>}`.

Exit 0 when every row succeeded; 3 or 4 when an auth or credits error stopped it (the
report is still printed); 8 when any row failed, was skipped or didn't run.

### `cosmion regen <id>`

Runs a past generation again with the same model, prompt, settings (seed included) and
references. Only where the images go can change.

Options: `--out <path>`, `--force`, `--json` (as `gen`). Prints the new history entry,
with `regen_of` set to `<id>`.

### `cosmion history`

Lists past generations, newest first.

Options: `--limit <n>` (default 20), `-m, --model <id>`, `--json`.

`{"entries": [<entry>, …]}`, each entry as `gen` prints it.

### `cosmion show <id>`

Shows one generation in full, with `"exists": true|false` added to each image (false
when the file was moved or deleted). An unknown id exits 5.

Options: `--json`.

### `cosmion usage`

Totals spending over a period, by model or by day (local time).

Options: `--since <when>` and `--until <when>` (a date such as `2026-10-01`, or days back
such as `7d`; default the last 30 days), `--by <group>` (`model` or `day`), `--json`.

`{"since", "until", "by", "total_usd", "generations", "images", "unknown_cost_count", "groups": [{"key", "total_usd", "generations", "images", "unknown_cost_count"}]}`

Generations whose cost isn't known are counted in `unknown_cost_count`, not as $0.

### `cosmion auth`

Checks a key with OpenRouter and saves it (readable by the user only). Agents pass it on
stdin: `cosmion auth --stdin --json < key.txt`. Without `--stdin` and without a terminal,
it exits 2.

Options: `--stdin`, `--json`. Prints `{"saved": true, "label"}`; a rejected key exits 3
and saves nothing.

### `cosmion auth status`

Shows which key is in use and what it has left.

Options: `--json`.

`{"source": "env|file|none", "valid", "label", "limit_usd", "limit_remaining_usd", "usage_usd", "balance_usd"}`. A rejected key is `"valid": false` with exit 0.

### `cosmion auth logout`

Removes the saved key (not `OPENROUTER_API_KEY`).

Options: `--json`. Prints `{"removed": true|false}`.

### `cosmion doctor`

Checks Node, the key, OpenRouter, the model catalog, the settings file's permissions,
the folders, the history file and whether an installed skill is out of date.

Options: `--json`.

`{"checks": [{"name", "status": "ok|warn|fail", "message", "fix"}]}`. `fix` says what to
do, and is `null` when the check passed. Exit 0 when nothing fails (warnings are fine),
8 otherwise.

### `cosmion skill install`

Installs this `SKILL.md` as `cosmion/SKILL.md` in agents' skills folders. Agents sharing a
folder share one copy. An existing `cosmion/SKILL.md` that Cosmion didn't write exits 2
unless `--force` is passed.

Options: `--agent <name>` (repeatable: `claude-code`, `codex`, `opencode`, `antigravity`,
`cursor`, `grok-build`, `copilot`), `--global` (home folder, all projects) or
`--project` (current folder), `--dir <path>` (any skills folder, repeatable), `--force`,
`--json`. Without a terminal, pass `--agent` with `--global` or `--project`, or `--dir`.

| Agent | Global | Project |
|-------|--------|---------|
| `claude-code` | `~/.claude/skills` | `.claude/skills` |
| `codex`, `opencode`, `cursor`, `grok-build`, `copilot` | `~/.agents/skills` | `.agents/skills` |
| `antigravity` | `~/.gemini/config/skills` and `~/.gemini/antigravity-cli/skills` | `.agents/skills` |

`{"installed": [{"path", "scope": "global|project|dir", "agents": [...]}]}`

### `cosmion skill update`

Rewrites Cosmion's installed copies that came from another version: those in every global
folder above and in the current folder's project folders. Run it after upgrading Cosmion.

Options: `--dir <path>` (also update the copy there, repeatable), `--json`.

`{"skills": [{"path", "status": "updated|current"}]}`

### `cosmion skill uninstall`

Removes Cosmion's installed copies, never anything else. With no options, every global and
project copy; `--agent`, `--global`, `--project` and `--dir` narrow it.

Options: `--agent <name>` (repeatable), `--global`, `--project`, `--dir <path>`
(repeatable), `--json`.

`{"removed": [{"path", "agents": [...]}]}`. `agents` lists every agent using that folder.

### `cosmion schema`

Prints the whole interface as JSON (with or without `--json`):
`{"version", "commands": [{"name", "summary", "args", "options", "output"}], "error", "exit_codes"}`.

Options: `--json`.

## Errors

With `--json`, a failure prints one object on stdout:

```json
{ "error": { "code": "rate_limited", "message": "…", "retryable": true } }
```

`retryable: true` means trying the same command again later may work.

## Exit codes

| Code | Meaning | `error.code` |
|------|---------|--------------|
| 0 | Success | |
| 1 | Unexpected error, or a local write failed | `internal` |
| 2 | Invalid usage or input: flags, values, files, paths, input needed without a terminal, or OpenRouter refusing the request (400) | `usage` |
| 3 | No key, or the key was rejected | `auth` |
| 4 | Insufficient credits or the key's limit reached; the message says which | `credits` |
| 5 | Unknown model or history id | `not_found` |
| 6 | Rate limited; retryable | `rate_limited` |
| 7 | OpenRouter, provider or network failure; retryable, except Cosmion's own 5-minute timeout | `upstream` |
| 8 | Finished, but some parts failed or were skipped (`batch` rows, `doctor` checks). Not an error: the normal result is printed | |
| 130 | Interrupted (Ctrl-C); nothing on stdout | |

## Example

```sh
cosmion price -m bytedance-seed/seedream-4.5 --resolution 2K --json
cosmion gen "a lighthouse at dusk, watercolor" -m bytedance-seed/seedream-4.5 \
  --resolution 2K --out images/lighthouse.png --json
```

Report the saved path (`images[].path`) and the cost (`cost_usd`) to the user.
