# Cosmion: terminal design

How the CLI looks to a person at a terminal. The code is in `src/cli/pretty.ts` and each
command's `pretty` function.

## The one rule

**Pipes and agents see no change.** Styling and fitted tables appear only when the stream
is a terminal, `NO_COLOR` isn't set and `TERM` isn't `dumb`. Piped output and `--json` stay
exactly as they are, so nothing a script or agent reads depends on this document.

## The look

- **Color:** one blue accent (the terminal's bright blue), green, yellow and red for ok,
  warning and error, and dim for secondary text. Only colors the terminal's theme defines,
  never fixed RGB, so the output follows the person's theme.
- **Tables:** no boxes, because they cost width and get in the way when copying a row. Dim
  headers and one thin line under them; prices and counts are right-aligned.
- **Tables fit the window.** Long text shortens with `…`, then the least useful columns go.
  The id always stays in full: it's what you copy.
- **Wordmark:** the small two-line one, on the `cosmion` and `cosmion --help` screen only, never
  on a command's output. That screen groups the commands: Make, Choose, Look back, Set up.
- **Symbols:** `✓` done, `✗` failed, `!` needs a look, `→` what to do next, `?` and `›` a
  question waiting for an answer.
- **Paths:** underlined and clickable in terminals that support links.
- **Picking from a list:** arrow keys move, Space ticks (`◯` `◉`), Enter confirms. Nothing
  starts ticked. Answered questions collapse to one `✓` line, so the screen stays short.
- **Motion:** a spinner with elapsed time on `gen`; one progress line with a budget meter on
  `batch`; `doctor` shows each check as it finishes. A person is never left looking at a
  blank line.

## Everything is covered

Results, `--help` on every command, prompts, warnings and errors all follow this look.
`tests/cli/terminal.test.ts` fails if a command has text output without a `pretty`, or help
without styling. A prompt or progress message written directly to a stream has no such guard,
so style it when you add it.

Left plain on purpose: `--version` and `schema`, whose output is a value or JSON to be read
by other tools, and the stack trace from `COSMION_DEBUG`.

## Weight

No styling dependency: Node's built-in `styleText` does the work. Terminal output must never
add to startup or make a command wait.
