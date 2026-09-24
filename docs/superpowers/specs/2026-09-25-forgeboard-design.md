# Forgeboard Design Specification

**Date:** 2026-09-25  
**Status:** Approved for planning  
**Audience:** Open-source maintainers and contributors

## 1. Summary

Forgeboard is a local-first desktop workbench for developers who use AI models. It lets users organize reusable prompts, fill in template variables, connect to local or remote models, compare responses, and keep a searchable local history without requiring an account.

The first release is intentionally focused: prompt management plus a small model playground. It avoids autonomous agents, arbitrary code execution, team collaboration, and hosted infrastructure so the project can remain useful, safe, and maintainable.

## 2. Goals and non-goals

### Goals

- Make reusable AI workflows easy to organize and reuse.
- Work fully locally with Ollama.
- Support OpenAI-compatible remote providers.
- Keep workspaces and prompt content on the user's machine by default.
- Make API credentials available to the application without exposing them to the renderer.
- Provide clear errors, cancellation, import/export, and recovery behavior.
- Be usable on Windows, macOS, and Linux.
- Provide a polished, accessible interface suitable for an open-source release.

### Non-goals for v1

- Accounts, authentication, or a hosted backend.
- Automatic cloud synchronization.
- Team or shared workspaces.
- Autonomous agents or arbitrary shell-command execution.
- A plugin or extension marketplace.
- Telemetry or advertising.
- Billing or paid hosted services.

## 3. User experience

### Main flow

1. Open Forgeboard.
2. Create or select a workspace.
3. Choose a saved prompt or start a new request.
4. Enter values for template variables.
5. Select a saved model connection.
6. Run the request.
7. Review the response, status, timing, and model.
8. Save, export, or compare the result.

### v1 features

- Workspaces with create, rename, and delete actions.
- Prompt library with titles, descriptions, tags, search, and favorites.
- Prompt templates using `{{variable_name}}` placeholders.
- Automatic variable detection with validation for missing values.
- Saved model connections for Ollama and OpenAI-compatible endpoints.
- Configurable model name, base URL, and credential per connection.
- Response history with timestamps, model, duration, and status.
- Side-by-side comparison of two responses.
- Markdown and JSON import/export for prompts and workspaces.
- Light, dark, and system themes.
- Keyboard shortcuts for search, new prompt, and running a request.
- Local persistence with no account requirement.
- Optional network access only when a user runs a request.

### Interaction principles

- Make the current workspace and active connection visible at all times.
- Keep the prompt editor as the primary surface.
- Show a compact status indicator while a request is running.
- Preserve the user's prompt when a request fails.
- Never hide the existence of a network request; clearly identify the destination provider.
- Keep destructive actions behind confirmation dialogs.

## 4. Technical architecture

### Technology

- Electron for the desktop shell and operating-system integration.
- React and TypeScript for the renderer UI.
- Electron main process for privileged operations.
- A small, typed preload bridge between renderer and main.
- Versioned JSON persistence in the operating system's application-data directory.
- Vitest for unit and component tests.
- ESLint and TypeScript for static checks.

### Process boundaries

#### Main process

The main process owns:

- Application and window lifecycle.
- File-system access.
- Workspace, prompt, history, and settings persistence.
- Credential encryption through Electron `safeStorage` when available.
- Provider adapters and outbound network requests.
- Request cancellation and timeout handling.

#### Preload bridge

The preload exposes a narrow, typed API. It must not expose Node.js, Electron internals, arbitrary IPC channels, filesystem paths, or secrets. Every operation is validated in the main process.

#### Renderer

The renderer is responsible for:

- React components and state.
- Prompt editing and variable input.
- Workspace, connection, and history presentation.
- Displaying normalized results and errors.
- Requesting actions through the preload bridge only.

### Provider abstraction

A provider adapter receives a normalized request containing the rendered prompt, model, connection settings, and cancellation signal. It returns a normalized response or a typed error.

The initial adapters are:

- `OllamaProvider`: local OpenAI-compatible or native Ollama HTTP endpoints.
- `OpenAICompatibleProvider`: configurable base URL, model, and bearer credential.

The adapter interface should allow future providers without changing renderer code. Provider-specific response parsing stays in the main process.

### Network and streaming

- Provider requests are made by the main process, not directly by the renderer.
- Streaming is supported when a provider response exposes a compatible stream.
- A non-streaming fallback is used when streaming is unavailable.
- Requests have a configurable timeout and can be cancelled by the user.
- The renderer receives normalized status, response, and error events.

## 5. Data model and persistence

The store is a versioned JSON document saved in Electron's `app.getPath('userData')` directory. It includes a schema version so later releases can migrate data explicitly.

### Top-level records

```ts
type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type Prompt = {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

type Connection = {
  id: string;
  name: string;
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  model: string;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
};

type RequestRecord = {
  id: string;
  workspaceId: string;
  promptId?: string;
  connectionId: string;
  provider: string;
  model: string;
  renderedPrompt: string;
  response: string;
  status: "success" | "error" | "cancelled";
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
};

type Settings = {
  theme: "system" | "light" | "dark";
  defaultConnectionId?: string;
};
```

Credential values are not part of the JSON document. They are stored in a separate credential file under Electron's user-data directory, encrypted with Electron `safeStorage` when the operating system supports it, and represented in the main process by an opaque credential reference. The renderer's `Connection` value exposes only `hasCredential`. If secure storage is unavailable, the connection can be used for the current session but its credential is not persisted.

### Persistence guarantees

- Write to a temporary file, then atomically replace the main data file.
- Keep rotating backups of valid stores.
- Validate the schema before loading.
- If the main file is invalid, try the newest valid backup and show a recovery notice.
- Do not delete a previous valid store until a new store has been written successfully.
- Import creates a validation report and does not silently merge incompatible records.

## 6. Error handling and security

### User-visible errors

The UI maps errors into stable categories:

- Validation error.
- Offline or connection error.
- Authentication error.
- Rate-limit error.
- Provider or server error.
- Request timeout.
- Request cancelled.
- Local storage or import error.

Every error includes a short explanation and, when available, a safe technical detail. Technical details must be redacted and must never include bearer tokens, API keys, or full local secret values.

### Cancellation and timeouts

- Each run has a unique request ID.
- The renderer can request cancellation for an active request.
- The main process aborts the fetch and records the run as cancelled.
- Timed-out requests are reported as timeouts, not generic failures.
- A failed run does not remove the original prompt or its variables.

### Security requirements

- No secrets in renderer state, logs, exported prompt data, or error messages.
- Encrypt saved credentials with `safeStorage` when the OS provides encryption.
- If secure credential storage is unavailable, keep credentials in memory for the current session and explain that limitation in the UI.
- Validate provider URLs and reject unsupported or dangerous schemes.
- Do not execute prompt contents as shell commands.
- Do not make network requests until the user submits a run.
- Do not add telemetry in v1.

## 7. Testing strategy

### Unit tests

- Detect and replace valid prompt variables.
- Report missing variables clearly.
- Preserve literal text that is not a valid variable.
- Normalize successful provider responses.
- Map authentication, rate-limit, timeout, offline, and malformed-response errors.
- Redact secrets from errors and logs.
- Serialize and deserialize the versioned store.
- Apply future schema migrations with a fixture.
- Round-trip Markdown and JSON import/export.

### Component tests

- Create and edit a prompt.
- Search and filter a prompt list.
- Validate variables before submission.
- Show a loading state and successful response.
- Show a recoverable error state.
- Display and compare two response records.

### Integration and build checks

- Run the main-process provider adapter against a local mock HTTP server.
- Verify that a restart reloads valid data.
- Verify that a corrupt store falls back to a valid backup.
- Build the Electron application for Windows, macOS, and Linux in CI.
- Run lint, type-check, unit tests, and component tests on every pull request.

Tests must not require real API keys or external model services.

## 8. Repository and documentation

The repository will include:

```text
README.md
LICENSE
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
.github/workflows/ci.yml
docs/superpowers/specs/2026-09-25-forgeboard-design.md
src/
tests/
```

The README will explain the product, supported providers, installation, development commands, privacy behavior, model configuration, contribution workflow, and roadmap. The project will use the MIT license.

## 9. v1 acceptance criteria

Forgeboard v1 is ready for release when:

- A developer can install and launch the desktop application.
- A developer can create a workspace and save prompts.
- A developer can connect to Ollama and an OpenAI-compatible endpoint.
- A developer can run a prompt containing variables.
- Responses, timings, status, and errors are visible and understandable.
- Data and settings survive an application restart.
- Workspace export and import work with validation and recovery feedback.
- Credentials are not exposed to the renderer or logs.
- A failed request preserves the user's work and can be retried.
- Automated checks pass for linting, type-checking, tests, and packaging.
- The documentation is sufficient for a new contributor to run the project locally.

## 10. Future direction

After a stable v1, possible additions include:

- Encrypted sync adapters.
- Shared workspace templates.
- Response evaluation and comparison reports.
- Importers for common prompt libraries.
- Additional local model providers.
- Optional extensions with explicit permission scopes.

These are not part of the v1 scope and will be added only after the core data and provider boundaries are stable.
