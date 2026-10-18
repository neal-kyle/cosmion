# Desktop app: exploration, not planned

> **This is not planned.** Cosmion is a CLI. This page keeps architecture
> thinking about a possible desktop app, done in October 2026, so it isn't
> lost if the idea is ever picked up. Nothing here is promised, scheduled or being built.

## The idea

A local, pay-as-you-go image studio for any OpenRouter model, with the same
bring-your-own-key model as the CLI. Not a companion to the CLI and not aimed
specifically at designers; its audience would have to be decided first, since that also
decides whether a signed Mac build is needed.

## If it's ever built

- **Shared code, never shared data.** The app would reuse the CLI's `src/core`
  (OpenRouter client, catalog, pricing, settings-file helper), moved into its own package
  (`packages/core`, npm workspaces) at that point. That move is mechanical because
  `src/core` never imports from the CLI. At runtime the two would know nothing about each
  other: separate settings, history and images. The CLI's folders are already named
  `cosmion-cli` so they'd never collide with the app's (macOS folder names are
  case-insensitive).
- **The app would fully own its library**, so its images can't go missing behind its
  back; the CLI keeps saving where it's asked and never manages images afterwards.
- **Sign in with OpenRouter (OAuth PKCE)** would arrive with the app, so app users never
  copy a key (`docs/openrouter-api.md` → Sign in). **(verify)** whether OpenRouter's
  sign-in page lets users set a spending limit on the key it creates; if not, the app
  suggests setting one.
- Design foundations first (color, type, spacing, glass tokens), then each surface just
  ahead of its spec.

Rough effort, as estimated: UI components ~1 week (design work is the bigger share), app screens ~1
week, CI, screenshot testing, installers and "how to open" docs 2–3 days.

## Architecture

### Stack

| Layer | Pick | Why |
|-------|------|-----|
| Shell | **Electron** | Window, menus, file access, installers; same Chromium everywhere |
| Build tooling | **electron-vite** | TypeScript, fast reloads while designing |
| UI framework | **React** | Best ecosystem of headless component libraries |
| Components | **React Aria Components + starter kit** (in `src/ui`) | Complete, consistent, ready-styled set we own and theme; best-in-class accessibility and desktop behavior (keyboard, drag and drop, grids). Apache 2.0. Meta's Astryx (pre-1.0 at the time) is the alternative to evaluate first |
| Styling | **Plain CSS + design tokens** | React Aria's plain-CSS starter kit, themed through our tokens (CSS variables); full control, no build-time styling tools |
| Animation | **Motion** | Crafted transitions |

#### Library

- **Images:** `~/Pictures/Cosmion` (the OS pictures folder), visible to the user.
- **Records:** SQLite (better-sqlite3) in the app's data folder: generations (prompt,
  model, settings, cost, token counts, provider, file, dimensions, thread, time) and
  threads (id, name, time). A database here because the Gallery needs fast sorting,
  grouping by date and thread, and paging through many images.
- **Schema version** stored in the database; the app upgrades older databases on open.
- **Deleting** an image removes its file and its record; deleting a thread deletes its
  images. Both ask for confirmation.
- Settings (key, name, appearance, type) in the app's own config folder, separate from the
  CLI.

#### Process model

- **Main process** runs `core` and the library: network, database, API key, OS menus and
  dialogs.
- **Renderer** (the UI) has no Node access. It talks to the main process through a small
  typed API exposed by the preload script, with context isolation on. The renderer never
  sees the API key.

#### `apps/desktop/src/ui`

A folder in the desktop app, not a separate package, since only the app uses it. Our own
components, all built on React Aria. Screens are assembled only from these, never from
raw styled HTML. Optionally developed in isolation with Storybook or Ladle. Visual design
isn't covered here.

- **Nearly everything** starts from React Aria's starter kit, copied in and themed
  through our design tokens.
- **Custom** only where no library helps: prompt box, canvas deck, justified gallery,
  image details.

#### Desktop behavior requirements

Implemented in the app shell regardless of visual design.

- Real OS menu bar (essential on macOS); Cmd vs Ctrl shortcuts per platform
- Native open/save dialogs
- Drag-and-drop in, and drag images out to Finder/Explorer/file managers
- Own right-click context menus (never the browser's "Inspect")
- Remember window size/position
- Undo/redo where it makes sense
- Disable browser behaviors: Ctrl+R reload, page zoom, text selection on UI chrome,
  dragging of UI images, rubber-band scrolling of the whole window
- Performance: fast startup, no full-screen spinners, no layout shift while loading,
  gallery thumbnails instead of full-size images, lean renderer bundle

### Data flow

1. UI calls `generate(...)` through the preload API.
2. Main process: price from `core`, request from OpenRouter.
3. Save the image to the library folder; write a library record.
4. Send progress and the result back to the UI.

### Security

- The API key lives only in the app's user-only settings file and the main process; the
  renderer never sees it.
- Renderer: context isolation on, no Node integration, only the typed preload API. The
  app loads no web content: a strict content security policy, and every link opens in the
  user's browser.

### Build and distribution

| What | Where | How |
|------|-------|-----|
| macOS | GitHub Releases | ad-hoc signed `.dmg` (arm64 + x64), via electron-builder |
| Windows | GitHub Releases | installer, via electron-builder |
| Linux | GitHub Releases | AppImage and `.deb`, via electron-builder; later Flatpak and AUR |

- **Native module:** better-sqlite3; electron-builder rebuilds it for Electron.
- **Updates:** check GitHub Releases on launch and show a quiet "new version available"
  notice linking to the download. Automatic updates need a properly signed macOS app
  (Windows and Linux could have them sooner).
- **Signing, $0 budget:** macOS ad-hoc signed only (required on Apple Silicon); users
  approve once via System Settings → Privacy & Security → "Open Anyway". Apple Developer
  membership ($99/yr) for notarization only if the audience needs it: the unsigned-app
  warning stops most non-developers. Windows unsigned → SmartScreen "More info → Run
  anyway"; free options to try: SignPath Foundation and the Microsoft Store.
- **Landing page:** an app section with a download button that detects the visitor's OS
  (pointing at GitHub Releases), and "how to open" instructions with screenshots for
  macOS Gatekeeper and Windows SmartScreen.

### Testing

- Vitest (shares Vite config with electron-vite); React Testing Library for component
  behavior.
- Cross-platform visual checks: GitHub Actions' free macOS and Windows runners build and
  launch the app, and Playwright (which can drive Electron) captures screenshots of key
  screens as CI artifacts. Development is Linux-only, so this is how macOS and Windows
  get seen. Before a first release, a Mac tester and a Windows tester try download → open
  → first image.

### Decisions made while exploring

| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-17 | Electron, not Tauri | Linux-only development; Tauri uses a different engine per OS that couldn't be tested. Electron's single Chromium ships what's built. Cost: ~100–150 MB and more memory |
| 2026-10-17 | React + React Aria Components + CSS Modules + Motion (updated below: plain-CSS starter kit, clean app look) | Headless components with full visual control. Rejected pre-styled kits (MUI, Mantine, Chakra, shadcn) as generic; Tailwind as pulling toward generic UI; Svelte/Vue/Solid for fewer headless libraries |
| 2026-10-17 | App look changes to clean, modern, app-like with a blue brand color; components mostly from React Aria's plain-CSS starter kit, themed with CSS-variable tokens (replaces CSS Modules) | No longer aimed at designers, so the editorial typography goes; ready-made consistent components replace most custom surfaces. Glass and the Serif/Sans option stay. Installed design systems (React Spectrum, MUI, Fluent) would fight the glass; Meta's Astryx is promising but pre-1.0, so it's an alternative to evaluate first |
| 2026-10-17 | Ship unsigned | $0 budget for a free, open-source BYOK project |
| 2026-10-17 | **Decoupled products: shared code, no shared data** (replaces the earlier shared ledger and "companion app" plan) | A shared ledger meant the app tracking images in projects it doesn't control: missing-image placeholders, two kinds of delete, polling for changes. Decoupled, the CLI saves where asked and keeps its own JSON Lines ledger (no database, no native module), and the app owns its own library. Threads and deleting leave the CLI |
