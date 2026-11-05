# Changelog

What changed in each version of Cosmion that someone using it would notice. Versions follow
[semantic versioning](https://semver.org).

## 0.1.1 (2026-11-05)

### Fixed

- `--out <name>.gif` now asks the model for GIF, as `--out <name>.png` asks for PNG.
  Before, the model's default format (often PNG) was saved under the `.gif` name with no
  warning. GPT Image 2.6 offers `--format gif` and returns animated GIFs.
- A default `cosmion-<id>.gif` name is now checked for an existing file before anything
  is sent, like the other image extensions.

## 0.1.0

The first release: `gen`, `price`, `models`, `models rank`, `batch`, `regen`, `history`,
`show`, `usage`, `auth` (with `status` and `logout`), `doctor`, `skill` (`install`,
`update`, `uninstall`) and `schema`.
