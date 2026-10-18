# Ideas

Things that may come after the CLI's first releases. None of them are promised or
scheduled, and some may never happen. What's being built is specified in `specs/`.

## Explored

- [`cosmion tui`](tui.md): an interactive terminal screen with live prices and inline
  previews.
- [A desktop app](desktop-app.md): a local image studio built on the same core code.

## Smaller ideas

**Distribution**

- An AUR package. Many projects ignore AUR; Cosmion shouldn't. It could go up as soon as
  v0.1 ships.
- Homebrew, winget and scoop, as people ask.
- A standalone download for people without Node.

**Features**

- `cosmion auth login`: sign in with OpenRouter from the CLI (OAuth PKCE,
  `docs/openrouter-api.md` → Sign in).
- API keys in the OS keychain instead of a user-only file.
- An optional weekly CI check that flags OpenRouter pricing units or tier names Cosmion
  doesn't recognize.
