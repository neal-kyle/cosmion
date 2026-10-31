# Cosmion

Generate images with any OpenRouter model from your terminal or your agent: one CLI, your
own OpenRouter key, prices checked before you spend and every generation recorded.

```sh
npm install -g cosmion
```

It needs Node 22.12 or newer, on macOS, Linux or Windows. `csn` is installed as the short
form of `cosmion`: `csn gen …` is the same as `cosmion gen …`.

## Get started

1. Create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) and
   save it:

   ```sh
   cosmion auth
   ```

   It asks for the key without showing it, checks it with OpenRouter and saves it,
   readable by you only. Or set `OPENROUTER_API_KEY` instead.

   **Tip:** give the key a spending limit on OpenRouter. It's the one cap that holds
   whatever runs with the key, including an agent.

2. Find a model and check what it costs:

   ```sh
   cosmion models
   cosmion price -m bytedance-seed/seedream-4.5 --resolution 2K
   ```

3. Generate:

   ```sh
   cosmion gen "a lighthouse at dusk, watercolor" -m bytedance-seed/seedream-4.5 \
     --resolution 2K --out lighthouse.png
   ```

   The image is saved, and the generation, with what it cost, is added to your history:

   ```sh
   cosmion history
   cosmion usage --by day
   ```

Set `COSMION_MODEL` to stop passing `-m` every time.

## Commands

| Command | Does |
|---------|------|
| `cosmion gen <prompt>` | Generate images and save them |
| `cosmion price` | What a generation will cost, without spending anything |
| `cosmion models [id]` | List the image models, or show one with its options and prices |
| `cosmion models rank` | The models that support some options, cheapest first |
| `cosmion batch <file>` | Generate every row of a CSV or JSONL file, within a budget |
| `cosmion regen <id>` | Run a past generation again, same settings and seed |
| `cosmion history` | Past generations, newest first |
| `cosmion show <id>` | One generation in full |
| `cosmion usage` | What you spent, by model or by day |
| `cosmion auth` | Save your key (`auth status`, `auth logout`) |
| `cosmion skill install` | Install `SKILL.md` for your coding agents (`skill update`, `skill uninstall`) |
| `cosmion doctor` | Check that everything is set up |
| `cosmion schema` | The whole interface as JSON, for agents |

`cosmion <command> --help` shows each command's options. On a terminal, output has color and
tables fit the window; piped output stays plain, and `NO_COLOR=1` turns the styling off.

## With an agent

Every command takes `--json` and prints one JSON object on stdout, with stable exit codes
and no prompts when there's no terminal. [`SKILL.md`](SKILL.md) tells an agent how to use
all of it. Install it for your agents:

```sh
cosmion skill install
```

It asks which agents (Claude Code, Codex, OpenCode, Antigravity, Cursor, Grok Build,
Copilot) and whether for all projects or this one. Agents that share a skills folder share
one copy. For another agent, pass its skills folder: `cosmion skill install --dir <path>`.
After upgrading Cosmion, `cosmion skill update` brings the installed copies up to date;
`cosmion doctor` reminds you.

Or copy it yourself: it's at `$(npm root -g)/cosmion/SKILL.md`, and goes in an agent's
skills folder as `cosmion/SKILL.md`.

Then ask it something like:

> Make a 16:9 hero image of a lighthouse at dusk for the landing page, save it as
> `public/hero.png`, and tell me what it cost.

The agent runs something like:

```sh
cosmion price -m bytedance-seed/seedream-4.5 --aspect 16:9 --json
cosmion gen "a lighthouse at dusk" -m bytedance-seed/seedream-4.5 --aspect 16:9 \
  --out public/hero.png --json
```

and reads the saved path and `cost_usd` from the result. For many images, `cosmion batch`
takes a `--budget` and stops starting rows once it's used.

## Privacy

Your images and history stay on your machine. Prompts and reference images go to
OpenRouter and the model's provider.

## Where files go

Settings (your key), history and the model catalog cache live in your system's usual
folders for app config, data and cache. Set `COSMION_HOME` to keep them all under one
folder instead:

```sh
COSMION_HOME=~/cosmion-files cosmion gen "…"
```

Images go where you tell them (`--out`), or the current folder.

## Troubleshooting

`cosmion doctor` checks Node, your key, OpenRouter, the folders and the history, and says
how to fix what's wrong. If Cosmion reports an unexpected error, `COSMION_DEBUG=1` adds
the stack trace to include in a bug report:

```sh
COSMION_DEBUG=1 cosmion gen "…"
```

## License

MIT
