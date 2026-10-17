# `oriel tui`: exploration, not planned

> Not promised or scheduled. A possible addition after the CLI ships, kept here so the
> thinking isn't lost.

## The idea

An interactive terminal screen for generating images: type a prompt, pick a model and
settings, and see the price update as you change them, before spending anything. Images
preview inline in terminals that can show them. It would make "exact prices before
spending" something you see, which few image tools offer.

## If it's ever built

- **A subcommand, `oriel tui`, not a flag.** Every command takes `--json`, so a `--tui`
  flag would raise questions like what `oriel gen --tui --json` means. A subcommand keeps
  it separate, and agents never start it by accident.
- **Interactive terminals only.** Without a TTY it exits 2, like every other case that
  would need input (constitution V).
- **Same code as the other commands.** It calls `src/core` and the ledger like `gen` and
  `price` do, so its images show up in `history` and its prices follow the same rules.
  Nothing new in `core` should be needed; that's what the `core`/`cli` boundary is for.
- **Library:** Ink (React for the terminal) is the likely pick. Load it only when
  `oriel tui` runs, so other commands stay fast.
- **Image previews:** kitty, Ghostty, WezTerm and iTerm2 can show images inline; other
  terminals show the saved path or open the image in the system viewer.
- **Testing:** behavior only (what it does, not how it looks).
