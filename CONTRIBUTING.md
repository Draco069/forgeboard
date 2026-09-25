# Contributing to Forgeboard

Thanks for your interest. Forgeboard is a small Electron application with a hard
constraint: it must keep the user's prompts, credentials, and history on their own
machine, and it must never make a network request the user did not start.

This document describes how to get set up, what a change is expected to include, and
the project's ground rules.

> **Maintainer note:** this repository does not yet publish a maintainer contact
> address. Until one is added, use the private reporting channels described in
> [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and replace
> those references with a real address before announcing the project publicly.

## Requirements

- **Node.js 22.22.2 or newer.** This is the minimum in `package.json` (`engines`) and the
  version CI uses. `node --version` should report `v22.22.2` or higher.
- **npm**, shipped with Node.
- No global tooling is needed; everything runs through the local `node_modules`.
- A model provider is **not** required. The test suite uses mocked providers and a local
  mock HTTP server.

## Set up

```bash
npm ci        # first-time setup, or any time package-lock.json changes
npm run dev   # launch the app with hot reloading
```

Use `npm ci` rather than `npm install` when you want to reproduce CI exactly. Use
`npm install` when you are intentionally changing dependencies, and commit the updated
`package-lock.json` with the change.

## The checks your change must pass

Run all five. They are the same commands CI runs, in the same order:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run dist:dir   # only when you touch packaging or the build
```

What each one catches:

- `lint` — ESLint, including unused variables and variables you forgot to use with a
  leading underscore.
- `typecheck` — TypeScript in strict mode across both the renderer project and the
  Node/Electron project. There are no `any` escape hatches; model unknown input with
  Zod instead.
- `test` — the Vitest suite. Provider tests must never reach the internet or need a real
  API key.
- `build` — the production main, preload, and renderer bundles.
- `dist:dir` — the unpacked Electron application, and the check that catches a build
  configuration that only works in development.

## Code conventions

- **Keep the process boundary intact.** The main process owns the filesystem,
  credentials, and network. The renderer reaches it only through the typed preload
  bridge in `src/preload/index.ts`. Do not widen the bridge, do not enable Node
  integration, and do not add a preload method without a matching validated IPC
  handler in `src/main/ipc.ts`.
- **Validate every boundary input.** Anything crossing into the main process is parsed
  with a schema from `src/shared/validation.ts` before it touches the store or the
  network.
- **Never log, return, store, or export a credential.** Pass known secrets to
  `redactSecrets` before formatting a technical detail. If a new code path can surface a
  provider error message, add the redaction and a test for it.
- **One file, one responsibility.** Files should stay short enough to read in one
  sitting; extract rather than grow.
- **Keep provider-specific parsing in the main process.** A new provider is a new
  adapter behind the existing `ProviderAdapter` interface, not new renderer code.
- **TypeScript is strict.** Prefer `unknown` plus a Zod schema over a cast.

## Tests

- Add or update a test with every behavior change. A bug fix without a regression test
  is not finished.
- Use Vitest and Testing Library. Prefer asserting what the user can observe
  (accessible roles, names, and text) over internal state.
- Never add a test that requires network access, a real API key, or a downloaded model.
  Spin up a local `http.createServer()` instead.
- For renderer components, mock `window.forgeboard` rather than reaching into modules.

## Commit and pull request conventions

Commits follow Conventional Commits, as the existing history does:

```text
feat: add a user-visible capability
fix: correct a defect
docs: documentation only
chore: tooling, dependencies, configuration
test: tests only
refactor: behavior-preserving internal change
```

A good pull request:

1. Explains the problem before the solution, and says why this approach.
2. Is one logical change. Split unrelated cleanups out.
3. Includes the test output for the five commands above, or a note about which one does
   not apply.
4. Calls out any change to the security model, the data format (`schemaVersion`), or the
   preload bridge. Changes in these three areas get extra scrutiny.
5. Updates `README.md` when it changes user-visible behavior — the command table, the
   provider setup instructions, and the data-location table are all checked against the
   code.

## Reporting bugs

Open an issue describing what you did, what you expected, and what happened. Include the
Forgeboard version (shown in the app), your operating system, and the error message with
any technical detail. Please redact anything sensitive before pasting.

If you have found a security vulnerability, do **not** open a public issue. Follow
[SECURITY.md](SECURITY.md).

## Code of Conduct

Participation in this project is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Contributions are accepted under the [MIT License](LICENSE).
