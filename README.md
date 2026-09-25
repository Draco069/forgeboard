# Forgeboard

A local-first AI workbench for developers. Forgeboard keeps a searchable library of
reusable prompts, fills in template variables, and runs the result against a local
Ollama model or any OpenAI-compatible endpoint — without an account, a server, or
telemetry.

Forgeboard is a desktop application built with Electron, React, and TypeScript. Your
workspaces, prompts, settings, and run history live in a versioned JSON file on your
own machine, and the only network request it ever makes is the one you start yourself.

---

## Features

- **Workspaces** — create, rename, switch, and delete; the last workspace cannot be deleted.
- **Prompt library** — titles, descriptions, tags, search, favorites, and a semantic list.
- **Prompt templates** — write `{{variable_name}}` placeholders; Forgeboard detects them,
  flags the ones you have not filled in, and refuses to run an incomplete prompt.
- **Model connections** — saved Ollama and OpenAI-compatible connections with a name,
  base URL, model, and optional credential.
- **Runs with live streaming** — responses stream in as the model produces them, with a
  status pill, elapsed time, and a cancel button.
- **History and comparison** — every run is recorded with its model, duration, and
  status; select two records to compare them side by side.
- **Import and export** — a full workspace JSON snapshot, and single prompts as Markdown.
- **Themes** — system, light, and dark, with keyboard-accessible focus states and
  reduced-motion support.
- **Keyboard shortcuts** — `Ctrl/Cmd+K` search, `Ctrl/Cmd+N` new prompt,
  `Ctrl/Cmd+Enter` run the selected prompt. Shortcuts stay out of the way while you are
  typing in a field.

## Privacy

Forgeboard is local-first by design, and it makes no promises it cannot keep:

- **No account, no sync, no telemetry, no analytics, no advertising.** There is no
  backend to talk to.
- **Your data stays on this device.** Workspaces, prompts, settings, and run history are
  written to a local versioned JSON file. Nothing is uploaded anywhere.
- **A network request happens only when you run a prompt**, and it goes only to the
  connection you selected. The destination provider is named in the run panel. Your
  prompt text — including everything you typed into the template variables — is sent to
  that provider, so choose an endpoint you trust. A local Ollama connection keeps
  everything on the machine.
- **Credentials never reach the interface.** A saved API key is stored in a separate
  file encrypted with the operating system's secure storage (Electron `safeStorage`).
  The renderer only ever sees whether a credential exists, never its value. If secure
  storage is unavailable on your system, the key is kept in memory for that session
  only and the UI tells you so.
- **Secrets are redacted from errors.** Provider failures are mapped to a fixed set of
  categories, and known credential values are stripped from technical details before
  they are shown, stored in history, or included in an export.
- **Prompt contents are never executed.** Nothing you type is passed to a shell.
- **Exports stay on your device until you save them.** A workspace export contains your
  prompts, connections, and retained runs — never a credential value. Store it
  somewhere you trust, and re-enter credentials after an import.

Read [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Requirements

- **Node.js 22.22.2 or newer** for development and CI (this is the `engines` field in
  `package.json`).
- Windows, macOS, or Linux for the desktop application.
- Ollama only if you want to use a local model. It is completely optional.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts electron-vite in development mode: the main process, the preload
bridge, and the React renderer build and reload together, and Electron opens a window.

The first launch creates a workspace named **Personal workspace** in the application
data folder, with no prompts and no connections.

## Connecting a model

Open **Settings → Model connections → Add connection**. The defaults are already filled
in for each provider; you only need a name and a model that exists on that endpoint.

### Ollama (local)

1. Install [Ollama](https://ollama.com/) and make sure it is running. The Ollama
   desktop app starts its server for you; the command-line install needs `ollama serve`.
2. Pull a model, for example `ollama pull llama3.2`.
3. In Forgeboard, choose provider **Ollama**, keep the base URL
   `http://127.0.0.1:11434`, and set the model to the name you pulled.
4. Leave **Credential** empty — local Ollama does not need one.

### OpenAI-compatible endpoints

1. Choose provider **OpenAI-compatible**.
2. Set the base URL to your endpoint, keeping any path prefix (for example
   `https://api.openai.com/v1` for OpenAI, or the base URL your gateway documents).
3. Set the model to a model your endpoint serves.
4. Paste the API key into **Credential** if the endpoint needs one. The value is sent
   once to the main process, encrypted at rest, and never shown again.

Forgeboard posts to `<base URL>/chat/completions` for OpenAI-compatible endpoints and
`<base URL>/api/chat` for Ollama. Only `http:` and `https:` URLs are accepted, and a URL
that embeds credentials (`https://user:key@host`) is rejected — use the Credential field
instead.

### Running a prompt

1. Pick or create a prompt, then fill in every detected variable.
2. Choose a connection and an optional timeout (100–60,000 ms, 60,000 ms by default).
3. Press **Run**. Deltas stream in as they arrive; **Cancel** aborts the request and
   records it as cancelled without touching your prompt.

Failures are reported as one of: validation, offline, authentication, rate limit,
provider, timeout, cancelled, storage, or import — with a retry action when retrying
makes sense.

## Everyday commands

These are the exact scripts in `package.json`:

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies, updating `package-lock.json` if needed |
| `npm run dev` | Start the app with hot reloading |
| `npm run build` | Build the main, preload, and renderer bundles into `out/` |
| `npm run preview` | Run Electron against the current build output |
| `npm run lint` | Run ESLint over the project |
| `npm run typecheck` | Type-check the renderer and the Node/Electron projects |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run dist` | Build and package installers for the current platform into `dist/` |
| `npm run dist:dir` | Build and produce the unpacked application into `dist/` |

The same four checks CI runs — `lint`, `typecheck`, `test`, `build` — should pass before
you open a pull request.

## Building installers

```bash
npm run dist      # installers for the platform you are building on
npm run dist:dir  # unpacked app, useful for a quick smoke test
```

Two things to know before you publish anything:

- **Platforms are built one at a time.** electron-builder produces artifacts for the
  host operating system only: `nsis` on Windows, `dmg`/`zip` on macOS, and
  `AppImage`/`deb` on Linux. Producing all three needs a build machine (or CI runner) for
  each platform, and this is a hard requirement rather than a convenience:
  - macOS refuses to build anywhere except macOS ("Build for macOS is supported only on
    macOS").
  - The Linux `AppImage` target fails on Windows because it cannot create the symlinks it
    needs. `electron-builder --linux --dir` does work from any host if you only need to
    inspect the packaged Linux layout.
  - The Linux `.deb` target uses the repository URL declared in `package.json`; build it
    on a Linux runner.
- **The configuration in this repository does not sign anything.** `appId` is a
  placeholder (`dev.forgeboard.app`), and no code-signing identity, notarization
  profile, or update feed is configured. Artifacts built from `electron-builder.yml` as
  committed are unsigned, and macOS will gatekeep them. Add your own identity before
  distributing binaries.

The packaged application contains only `package.json`, the compiled `out/main`,
`out/preload`, and `out/renderer` output, and the production dependencies the main
process imports at runtime. Sources, tests, fixtures, build configuration, and local
data are not shipped.

## Where your data lives

Forgeboard uses the Electron `userData` directory for the application name
(`forgeboard`):

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\forgeboard` |
| macOS | `~/Library/Application Support/forgeboard` |
| Linux | `~/.config/forgeboard` |

Inside that folder:

```text
forgeboard.json       # versioned workspace document (schemaVersion 1)
backups/              # the three most recent valid backups
credentials.json      # encrypted credentials, base64-encoded (only after you save one)
```

Alongside those, Chromium's own caches (`Cache`, `Code Cache`, `GPUCache`, and similar)
are created by the embedded browser engine.

Writes go to a temporary file, are flushed, and then atomically replace the main file,
so a crash mid-write cannot leave a half-written store. Before replacing the main file
the current valid document is rotated into the backup slots. If the main file fails
validation at startup, Forgeboard loads the newest valid backup and shows a recovery
banner; if there is no valid backup, it starts a fresh workspace and says so. Nothing is
deleted until a new valid document has been written.

Uninstalling does not delete this folder.

## Project structure

```text
src/
  shared/       Domain types, Zod schemas, prompt rendering, error mapping, serialization
  main/         Electron main: store, credential vault, provider adapters, IPC, lifecycle
  preload/      The narrow contextBridge API exposed as window.forgeboard
  renderer/     React application: state hook, views, components, styles
tests/          Vitest unit, component, and local-provider integration tests
docs/           Design specification and implementation plan
```

The process boundary is intentional. The main process owns the filesystem, credentials,
and every outbound request. The preload script exposes a fixed set of typed methods
(`getState`, workspace/prompt/connection CRUD, `updateSettings`, `runRequest`,
`cancelRequest`, `exportData`, `importData`, `onRunEvent`, `ping`) and nothing else — no
`ipcRenderer`, no `require`, no filesystem paths, no arbitrary channels. Every input is
validated with a shared Zod schema in the main process, and the renderer runs with
`contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

## Security model

- Secrets stay in the main process. `Connection` records expose `hasCredential: boolean`
  and nothing more.
- Provider URLs must be absolute `http:`/`https:` URLs without embedded credentials;
  model names and prompts are length-bounded before any request is made.
- The renderer has no Node integration, is sandboxed, cannot open new windows, cannot
  navigate, and is denied all permission requests.
- The renderer HTML ships a Content Security Policy that only allows same-origin
  resources, and response text is rendered as text, never as HTML.
- Requests are cancellable and time-bounded; a cancelled run keeps the user's prompt and
  variables intact.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, the checks a pull
request must pass, and the project's ground rules. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Roadmap

**Before a signed release**

- Code signing, macOS notarization, and an `appId` under a domain the project controls.
- An application icon; without one, electron-builder falls back to the default
  Electron icon on every platform.
- Release artifacts built for Windows, macOS, and Linux.
- A published maintainer contact for security reports and conduct reports.

**Next**

- Importers for common prompt libraries.
- Additional local model providers behind the same adapter interface.
- Response evaluation and comparison reports.
- Shared workspace templates.

**Explicitly not planned for v1**

Accounts, a hosted backend, automatic cloud sync, shared or team workspaces, autonomous
agents, shell-command execution, a plugin marketplace, telemetry, and paid services.
These are out of scope so the data and provider boundaries can stay stable.

## License

[MIT](LICENSE) © 2026 Forgeboard contributors
