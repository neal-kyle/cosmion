# Contributing to Cosmion

Thanks for wanting to help. I maintain Cosmion on my own in my spare time, so replies may
take a while, and I may say no to some ideas.

## What to send

The most useful help right now is making what's already here work better, rather than
adding new features. For example: fixing bugs, making error messages clearer, or fixing
problems on your operating system.

**Go ahead and open an issue or pull request for:**

- Bug reports. Include the command you ran, what happened, your Cosmion version
  (`cosmion --version`) and your operating system. If it only happens with one model, say
  so. Leave out your API key.
- Bug fixes.
- Corrections to the docs.

**Open an issue first for:**

- New commands or options.
- Any change to `--json` output or exit codes, because agents rely on them.
- Refactors and code cleanups.
- Anything else big.

That way we can agree on it before you spend time building it. A few lines on what you
want and why is enough. If you build a feature we haven't agreed on, I may close the pull
request, however good the code is.

## Building a new feature

Once we've agreed on the issue:

1. Use [Spec Kit](https://github.com/github/spec-kit) to write the spec, plan and tasks
   (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`), and open one pull request with
   all three.
2. I'll review them. Wait for my go-ahead before you write any tests or code.
3. Build it on the same branch. I'll merge the pull request when it's finished.

## Using AI

I build Cosmion with AI coding agents, and you're welcome to as well. You don't need to
read every line of code, but you should know what your change does and have tried it
yourself.

## Making a change

You need Node 22.12 or newer. You don't need an OpenRouter key to run the tests, and they
don't spend anything.

```sh
npm install
npm run build
node dist/cli/main.js --help
```

Before you open a pull request, check that these pass:

```sh
npm run lint
npm test
```

- Keep each pull request to one change.
- Add a test for what you changed. For a bug fix, start with a test that fails because of
  the bug.
- Update `README.md` and `SKILL.md` if what Cosmion does has changed.
- In the pull request, say what changed and how you tried it.

The project's full rules are in the
[constitution](.specify/memory/constitution.md). If you use a coding agent, point it there
too. If something in there gets in your way, open the pull request anyway and we'll sort it
out.
