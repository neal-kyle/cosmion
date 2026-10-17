# Oriel — project notes

Items from the original plan that aren't architecture. See `ARCHITECTURE.md` for how
the system is built.

## Direction

- Free, open-source, bring-your-own OpenRouter account. No paid cloud version
  (Higgsfield etc. already own that space).
- **Two products, one brand** (2026-10-17). They share code, not data.
  - **Oriel CLI: the primary product, for developers and their agents.** Generate images
    with any OpenRouter model from the terminal or an agent, saved straight into your
    project, with exact prices and a local record of what you spent.
  - **Oriel desktop app: later.** A local, pay-as-you-go image studio. Its audience is
    revisited at Milestone 2; it's not aimed specifically at designers.
  - Ordinary users aren't targeted (they use ChatGPT).
- **Why Oriel over ChatGPT or a subscription:** any image model, pay as you go, images
  stay on your machine (local-first, data sovereignty), and it works with your agents.
- Released as a beta, openly built with AI. Developers are the audience most comfortable
  with both.
- Build order: see `ROADMAP.md`.
- **App look** (changed 2026-10-17): clean, modern and app-like, blue brand color, liquid
  glass on floating controls. See `DESIGN.md`.

## Design

See `DESIGN.md`.

## Effort estimate

Rough, for focused work.

| Piece | Effort |
|-------|--------|
| Milestone 1A: core + first CLI release | ~3–5 days |
| Milestone 1B: power commands | ~3–5 days |
| Milestone 2: UI components (design work is the bigger share) | ~1 week |
| Milestone 2: app screens | ~1 week |
| Milestone 2: CI, screenshot testing, installers, "how to open" docs | 2–3 days |

## Open questions

- Name: **Oriel** (decided 2026-10-17). Still to check: domain, trademarks on other
  software products, and an npm scope / GitHub org (see `DESIGN.md` → Brand).
- License (MIT or Apache-2.0): the owner picks before the first npm publish (Milestone
  1A).

## Landing page

Yes, around the first CLI release. CLI-first, the app added at Milestone 2.

- One static page: what it is, the install command (`npm install -g oriel`), a short
  example of using it from the terminal and from an agent, the "bring your own
  OpenRouter account" explanation and the privacy sentence, link to the repo.
- Same visual identity as the app (blue brand, clean type).
- Host on GitHub Pages or Cloudflare Pages.
- The repo README stays the entry point for developers.
- **At Milestone 2:** an app section with a download button that detects the visitor's
  OS (pointing at GitHub Releases), and "how to open" instructions with screenshots for
  macOS Gatekeeper and Windows SmartScreen.
