# Forgeboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Forgeboard, a polished local-first Electron desktop workbench for organizing developer prompts and running them against Ollama or OpenAI-compatible models.

**Architecture:** Use an Electron main process for persistence, encrypted credentials, provider requests, and validation; expose only a typed preload bridge to a React renderer. Keep versioned workspace data in an atomically-written JSON store, keep secrets in a separate `safeStorage`-encrypted file, and normalize provider behavior behind a small adapter interface so the UI never handles credentials or arbitrary IPC.

**Tech Stack:** Electron, React, TypeScript, electron-vite, Vite, Zod, Vitest, Testing Library, ESLint, electron-builder.

## Global Constraints

- Support Windows, macOS, and Linux desktop builds.
- Work locally without an account; local Ollama use must not require a network service.
- Treat OpenAI-compatible providers as optional online connections; never make a network request until the user submits a run.
- Never expose API keys, bearer tokens, or encrypted secret values to the renderer, exports, history, or logs.
- Do not execute prompt contents as shell commands and do not add telemetry in v1.
- Use a versioned JSON data format with schema migrations, atomic writes, rotating valid backups, and recovery feedback.
- Use the MIT license and provide contributor, security, and conduct documentation.
- Keep the renderer dependent on a narrow typed preload API; do not enable Node integration.
- Use mocked providers in tests; tests must not require real API keys or internet access.
- Use focused files with one clear responsibility and keep provider-specific parsing in the main process.
- Use Node.js 22.22.2 or newer for development and CI, matching the locked toolchain requirements.

---

## File map

| File | Responsibility |
| --- | --- |
| `package.json` | Scripts and runtime/dev dependencies |
| `electron.vite.config.ts` | Main, preload, and renderer builds |
| `tsconfig.json`, `tsconfig.node.json` | TypeScript project boundaries |
| `vitest.config.ts` | Unit/component test environment |
| `eslint.config.js` | Flat ESLint configuration |
| `src/shared/types.ts` | Shared domain records and typed bridge contract |
| `src/shared/errors.ts` | Stable error categories and secret redaction |
| `src/shared/prompt.ts` | Template variable extraction and rendering |
| `src/shared/serialization.ts` | Prompt Markdown and snapshot JSON serialization |
| `src/shared/validation.ts` | Zod schemas for IPC and persisted data |
| `src/main/store.ts` | Versioned JSON repository, migrations, backups, and recovery |
| `src/main/credentials.ts` | OS-backed encrypted credential vault |
| `src/main/providers.ts` | Provider URL validation, adapters, streaming, and error mapping |
| `src/main/request-service.ts` | Request lifecycle, cancellation, events, and history records |
| `src/main/ipc.ts` | Validated IPC handlers and renderer event delivery |
| `src/main/index.ts` | Electron app/window lifecycle and dependency wiring |
| `src/preload/index.ts` | Narrow contextBridge API |
| `src/renderer/main.tsx` | React entry point |
| `src/renderer/App.tsx` | Application state composition and view routing |
| `src/renderer/hooks/useForgeboard.ts` | Bridge subscription and state synchronization |
| `src/renderer/components/` | Focused UI components and dialogs |
| `src/renderer/styles.css` | Responsive visual system and component styles |
| `tests/` | Pure, component, and local-provider integration tests |
| `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | Open-source project documentation |
| `.github/workflows/ci.yml` | Lint, type-check, test, and build workflow |
| `electron-builder.yml` | Packaging metadata and artifact targets |

---

### Task 1: Bootstrap the Electron/React toolchain and a safe window shell

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Create: `src/renderer/env.d.ts`
- Create: `tests/app-shell.test.tsx`

**Interfaces:**
- Produces `window.forgeboard.ping(): Promise<{ app: string; version: string }>` for the initial shell.
- The later bridge will replace `ping` without changing the renderer's isolation model.

- [x] **Step 1: Create package metadata and scripts**

Use the following package contract:

```json
{
  "name": "forgeboard",
  "version": "0.1.0",
  "private": true,
  "description": "A local-first AI workbench for developers",
  "main": "./out/main/index.js",
  "author": "Forgeboard contributors",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "npm run build && electron-builder",
    "dist:dir": "npm run build && electron-builder --dir"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "electron": "latest",
    "electron-vite": "latest",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@testing-library/user-event": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@typescript-eslint/eslint-plugin": "latest",
    "@typescript-eslint/parser": "latest",
    "eslint": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest",
    "electron-builder": "latest"
  }
}
```

After creating the file, run `npm install` and commit the generated `package-lock.json` with the scaffold.

- [x] **Step 2: Configure electron-vite and TypeScript**

Use `electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
```

Use a renderer `tsconfig.json` that includes `src/renderer`, `src/shared`, and `tests`, and a node `tsconfig.node.json` that includes `src/main`, `src/preload`, and configuration files. Set `strict: true`, `noEmit: true`, `moduleResolution: "bundler"`, and `jsx: "react-jsx"`.

- [x] **Step 3: Add the initial secure Electron window**

Implement `src/main/index.ts` with `app.whenReady()`, one `BrowserWindow`, and these security options:

```ts
webPreferences: {
  preload: join(__dirname, "../preload/index.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
```

Load `join(__dirname, "../renderer/index.html")` in development and `file://` production output through the standard electron-vite environment check. Handle `window-all-closed` for macOS and activate for a new window.

Implement `src/preload/index.ts` with only the initial ping method:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("forgeboard", {
  ping: () => ipcRenderer.invoke("app:ping"),
});
```

- [x] **Step 4: Add the initial renderer shell and accessibility baseline**

Render a centered Forgeboard welcome card with a visible product name, a short local-first description, and a `data-testid="app-shell"` root. Use semantic `header`, `main`, and `button` elements, visible focus styles, and a CSS custom-property palette that supports light and dark color schemes.

- [x] **Step 5: Write and run the shell test**

Mock `window.forgeboard.ping` in `tests/app-shell.test.tsx`, render `App`, and assert that the product name and readiness message appear:

```tsx
it("renders the desktop shell", async () => {
  window.forgeboard = { ping: vi.fn().mockResolvedValue({ app: "Forgeboard", version: "0.1.0" }) };
  render(<App />);
  expect(await screen.findByText("Forgeboard")).toBeInTheDocument();
});
```

Run:

```bash
npm run typecheck
npm test -- --run tests/app-shell.test.tsx
npm run build
```

Expected: all three commands pass.

- [x] **Step 6: Commit the scaffold**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json tsconfig.node.json vitest.config.ts eslint.config.js .gitignore src tests/app-shell.test.tsx
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "chore: bootstrap Forgeboard desktop app"
```

---

### Task 2: Define the shared domain model and pure prompt/data utilities

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/errors.ts`
- Create: `src/shared/prompt.ts`
- Create: `src/shared/serialization.ts`
- Create: `src/shared/validation.ts`
- Create: `tests/prompt.test.ts`
- Create: `tests/errors.test.ts`
- Create: `tests/serialization.test.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- `Prompt`, `Workspace`, `Connection`, `RequestRecord`, `Settings`, and `StoreDocument` are the canonical record types.
- `extractVariables(template: string): string[]` returns unique variable names in first-seen order.
- `renderPrompt(template: string, values: Record<string, string>): { text: string; missing: string[] }` leaves unresolved variables visible in `missing` and does not throw.
- `redactSecrets(value: string, secrets: string[]): string` replaces every non-empty secret with `[REDACTED]`.
- `normalizeAppError(error: unknown): AppError` returns a stable code, safe message, optional safe detail, and retryability.
- `serializePromptMarkdown(prompt: Prompt): string` and `parsePromptMarkdown(markdown: string): PromptDraft` provide a reversible Markdown representation for a single prompt.
- `parseStoreDocument(value: unknown): StoreDocument` validates persisted data and migrations.

- [x] **Step 1: Write failing prompt utility tests**

Cover valid variables, duplicates, missing values, and literal braces:

```ts
it("extracts unique variables in first-seen order", () => {
  expect(extractVariables("Fix {{language}} then test {{language}} and {{error}}")).toEqual([
    "language",
    "error",
  ]);
});

it("reports missing variables without losing the template", () => {
  const result = renderPrompt("Fix {{language}}: {{error}}", { language: "TypeScript" });
  expect(result.missing).toEqual(["error"]);
  expect(result.text).toBe("Fix TypeScript: {{error}}");
});
```

- [x] **Step 2: Implement the prompt module**

Use a strict variable token of letters, digits, underscore, and hyphen, with a non-empty name:

```ts
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function renderPrompt(template: string, values: Record<string, string>) {
  const missing = extractVariables(template).filter((name) => !values[name]?.trim());
  const text = template.replace(VARIABLE_PATTERN, (_, name: string) => values[name] ?? `{{${name}}}`);
  return { text, missing };
}
```

- [x] **Step 3: Write failing error and serialization tests**

Test that a bearer token is redacted, an Electron error becomes a safe app error, Markdown includes title/tags/body, and JSON import/export preserves IDs and timestamps.

- [x] **Step 4: Implement errors, Markdown, and validation**

Define stable error codes:

```ts
export type AppErrorCode =
  | "VALIDATION"
  | "OFFLINE"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "PROVIDER"
  | "TIMEOUT"
  | "CANCELLED"
  | "STORAGE"
  | "IMPORT"
  | "UNKNOWN";
```

`normalizeAppError` must never include an API key from an error message; it should call `redactSecrets` with any known secret values supplied by the caller. Use Zod schemas with a `schemaVersion` literal of `1`, bounded prompt lengths, valid HTTP(S) provider URLs, and enum values for provider, theme, and request status.

Use a Markdown format with a title heading, description, tags, and body separated by a fixed `---` marker. Parse only the fields Forgeboard owns and reject malformed frontmatter with `AppErrorCode.VALIDATION`.

- [x] **Step 5: Run focused tests and typecheck**

```bash
npm test -- --run tests/prompt.test.ts tests/errors.test.ts tests/serialization.test.ts
npm run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [x] **Step 6: Commit the domain layer**

```bash
git add src/shared src/renderer/env.d.ts tests/prompt.test.ts tests/errors.test.ts tests/serialization.test.ts
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add shared prompt and data model"
```

---

### Task 3: Implement the versioned local store and encrypted credential vault

**Files:**
- Create: `src/main/store.ts`
- Create: `src/main/credentials.ts`
- Create: `src/main/defaults.ts`
- Create: `tests/store.test.ts`
- Create: `tests/credentials.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/validation.ts`

**Interfaces:**
- `ForgeboardStore` constructor: `new ForgeboardStore(dataDirectory: string, credentials: CredentialVault)`.
- `ForgeboardStore.load(): Promise<LoadResult>` returns `{ document, recoveryNotice? }`.
- `ForgeboardStore.getState(): AppState` returns the current document, active workspace, recovery notice, and secure-credential availability.
- CRUD methods use `Promise<Workspace | Prompt | Connection | Settings>` and update timestamps in the main process.
- `CredentialVault` methods are `has(id): Promise<boolean>`, `get(id): Promise<string | undefined>`, `set(id, value): Promise<boolean>`, and `delete(id): Promise<void>`.
- `SecretCrypto` is injectable for tests and defaults to Electron `safeStorage` in production.

- [ ] **Step 1: Write failing store tests**

Use `mkdtemp()` and a fake crypto provider. Verify a default workspace exists, prompts can be saved and reloaded, an invalid main file recovers from a valid backup, and a failed write does not remove the prior valid document.

- [ ] **Step 2: Implement the default document and schema migration**

Create `src/main/defaults.ts` with a fresh document:

```ts
export function createDefaultDocument(): StoreDocument {
  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: "Personal workspace",
    createdAt: now,
    updatedAt: now,
  };
  return {
    schemaVersion: 1,
    workspaces: [workspace],
    prompts: [],
    connections: [],
    requests: [],
    settings: { theme: "system" },
    activeWorkspaceId: workspace.id,
  };
}
```

`parseStoreDocument` should reject unsupported schema versions with a typed import/storage error and provide a migration function for future version increments.

- [ ] **Step 3: Implement atomic persistence and recovery**

Store files as:

```text
<userData>/forgeboard.json
<userData>/backups/forgeboard-001.json
<userData>/backups/forgeboard-002.json
```

Before replacing the main file, copy the currently valid file to the next backup slot. Write to `forgeboard.json.tmp`, flush it, then rename it over the main file. Keep the last three valid backups. If the main file fails validation, load the newest valid backup and set `recoveryNotice` for the renderer.

- [ ] **Step 4: Implement `safeStorage`-backed credentials**

Store an encrypted map of connection IDs to credential values. Base64-encode encrypted buffers in the credential file. Never include the credential value in `StoreDocument`, returned `Connection` objects, or error text. If `safeStorage.isEncryptionAvailable()` is false, keep new values in an in-memory map, return `false` from `set`, and set the public connection's `hasCredential` to false after restart.

- [ ] **Step 5: Add CRUD and import/export methods**

Implement workspace, prompt, connection, request, and settings methods. Enforce referential cleanup: deleting a workspace removes its prompts and request records; deleting a connection marks its history records as retained but does not delete the historical response. `importSnapshot` validates the complete document before replacing state and returns counts plus warnings.

- [ ] **Step 6: Run store and credential tests**

```bash
npm test -- --run tests/store.test.ts tests/credentials.test.ts
npm run typecheck
```

Expected: persistence, backup recovery, session-only credentials, and import validation tests pass.

- [ ] **Step 7: Commit the persistence layer**

```bash
git add src/main/store.ts src/main/credentials.ts src/main/defaults.ts src/shared/types.ts src/shared/validation.ts tests/store.test.ts tests/credentials.test.ts
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add local encrypted data store"
```

---

### Task 4: Build provider adapters and the request lifecycle

**Files:**
- Create: `src/main/providers.ts`
- Create: `src/main/request-service.ts`
- Create: `tests/providers.test.ts`
- Create: `tests/request-service.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/errors.ts`

**Interfaces:**
- `ProviderAdapter.run(request: ProviderRequest, onDelta: (chunk: string) => void): Promise<ProviderResult>`.
- `ProviderRequest` contains `baseUrl`, `model`, `prompt`, optional `credential`, and `signal`.
- `ProviderResult` contains `text`, `model`, and optional provider metadata.
- `ProviderRegistry.get(kind: ProviderKind): ProviderAdapter`.
- `RequestService.run(input: RunInput, emit: (event: RunEvent) => void): Promise<RequestRecord>`.
- `RequestService.cancel(requestId: string): boolean`.

- [ ] **Step 1: Write failing provider integration tests**

Start a local `http.createServer()` and test:

```ts
it("normalizes an Ollama response", async () => {
  server = createProviderServer([
    { status: 200, json: { model: "llama3.2", message: { content: "done" } } },
  ]);
  const result = await registry.get("ollama").run({
    baseUrl: server.url,
    model: "llama3.2",
    prompt: "hello",
    signal: new AbortController().signal,
  }, () => undefined);
  expect(result.text).toBe("done");
});
```

Add tests for OpenAI-compatible JSON, OpenAI SSE chunks, Ollama NDJSON chunks, 401, 429, 500, malformed JSON, and aborted requests.

- [ ] **Step 2: Implement URL and request validation**

Only allow `http:` and `https:` URLs. Reject credentials embedded in URLs, empty model names, and prompts over the shared limit. Normalize trailing slashes without changing the path prefix. Use a 60-second default timeout and allow a caller-provided lower/equal upper bound.

- [ ] **Step 3: Implement non-streaming and streaming parsing**

For OpenAI-compatible providers, POST to `/chat/completions` with `{ model, messages: [{ role: "user", content: prompt }], stream }`. Parse JSON `choices[0].message.content` for non-streaming responses and parse `data:` SSE lines by extracting `choices[0].delta.content`.

For Ollama, POST to `/api/chat` with `{ model, messages, stream }`. Parse `message.content` for non-streaming responses and each newline-delimited JSON object's `message.content` for streaming responses. Accumulate chunks in the adapter and emit each delta once.

- [ ] **Step 4: Map provider failures to safe app errors**

Map HTTP 401/403 to `AUTHENTICATION`, 429 to `RATE_LIMIT`, aborts to `CANCELLED`, timeout aborts to `TIMEOUT`, network failures to `OFFLINE`, and all other provider failures to `PROVIDER`. Pass credential values to the redactor before formatting a technical detail.

- [ ] **Step 5: Implement `RequestService`**

Create a request ID in the main process, store an `AbortController` in a map, emit a `started` event, run the selected adapter, accumulate deltas, persist a `RequestRecord`, emit `completed` or `error`, and remove the controller in a `finally` block. A cancelled record has `status: "cancelled"` and an empty response if no text arrived.

- [ ] **Step 6: Run provider and lifecycle tests**

```bash
npm test -- --run tests/providers.test.ts tests/request-service.test.ts
npm run typecheck
```

Expected: all mocked provider responses, stream chunks, error categories, cancellation, and timeout cases pass without network access.

- [ ] **Step 7: Commit the provider layer**

```bash
git add src/main/providers.ts src/main/request-service.ts src/shared/types.ts src/shared/errors.ts tests/providers.test.ts tests/request-service.test.ts
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add AI provider request lifecycle"
```

---

### Task 5: Wire validated IPC and the complete preload bridge

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Create: `tests/ipc-contract.test.ts`

**Interfaces:**
- `registerIpcHandlers({ store, credentials, requestService, getWindow })` registers all handlers.
- `window.forgeboard` exactly exposes `getState`, workspace CRUD, prompt CRUD, connection CRUD, settings update, `runRequest`, `cancelRequest`, `exportData`, `importData`, and `onRunEvent`.
- IPC input is parsed with shared Zod schemas before any main-process operation.
- `onRunEvent` returns an unsubscribe function and strips the Electron event object before calling the renderer listener.

- [ ] **Step 1: Write the bridge contract test**

Assert that the preload source contains only the allowlisted method names and does not expose `ipcRenderer`, `require`, `process`, or filesystem APIs. Add a renderer mock implementing the complete `ForgeboardApi` for component tests.

- [ ] **Step 2: Register typed handlers**

Create handlers for:

```text
app:ping
state:get
workspace:create
workspace:rename
workspace:delete
prompt:save
prompt:delete
connection:save
connection:delete
settings:update
request:run
request:cancel
data:export
data:import
```

Every handler must call the corresponding shared schema, catch errors at the boundary, and return a serialized `AppError` object. No handler may return a credential value, filesystem path, raw `Error`, or provider response body.

- [ ] **Step 3: Deliver request events safely**

`RequestService.run` receives an emitter that calls `getWindow()?.webContents.send("request:event", event)`. Guard against a destroyed window. The preload listener receives only the event payload.

- [ ] **Step 4: Run contract, type, and build checks**

```bash
npm test -- --run tests/ipc-contract.test.ts
npm run typecheck
npm run build
```

Expected: no unvalidated IPC surface, no type errors, and a complete Electron build.

- [ ] **Step 5: Commit the secure bridge**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts tests/ipc-contract.test.ts
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: expose secure Forgeboard IPC bridge"
```

---

### Task 6: Build the renderer state layer and application shell

**Files:**
- Create: `src/renderer/hooks/useForgeboard.ts`
- Create: `src/renderer/state.ts`
- Create: `src/renderer/components/AppShell.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/components/Topbar.tsx`
- Create: `src/renderer/components/EmptyState.tsx`
- Create: `src/renderer/components/Icon.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer-state.test.tsx`

**Interfaces:**
- `useForgeboard()` returns `{ state, loading, error, refresh, runEventUnsubscribe }`.
- The reducer state has `view: "prompts" | "history" | "settings"`, `selectedPromptId`, `selectedRequestId`, `search`, and `theme`.
- `AppShell` accepts `children`, `state`, and view-navigation callbacks.
- Every icon-only control has an accessible label and a visible tooltip or text alternative.

- [ ] **Step 1: Write renderer state tests**

Mock the bridge, load an initial state, assert that the active workspace and navigation render, and assert that a `RunEvent` updates only the relevant active request state.

- [ ] **Step 2: Implement the bridge hook**

On mount, call `getState`, store the result, and subscribe to `onRunEvent`. Clean up the subscription on unmount. Expose a typed `refresh` function for mutation results and a visible initialization error state instead of throwing during render.

- [ ] **Step 3: Implement the shell components**

Build a three-region layout:

```text
┌──────────────┬─────────────────────────────────────┐
│ Forgeboard   │ Topbar: workspace, theme, actions   │
│ navigation   ├─────────────────────────────────────┤
│ workspaces   │ Active view                        │
│ new prompt   │                                     │
└──────────────┴─────────────────────────────────────┘
```

Use CSS variables for `--bg`, `--surface`, `--surface-raised`, `--text`, `--muted`, `--accent`, `--border`, and `--danger`. Include responsive breakpoints for narrow windows, `prefers-reduced-motion`, keyboard focus rings, and semantic headings.

- [ ] **Step 4: Replace the placeholder renderer with the shell**

Keep the loading state centered, show a recovery banner when `state.recoveryNotice` exists, and use an empty state with a clear “Create your first prompt” action when no prompt exists.

- [ ] **Step 5: Run renderer tests and build**

```bash
npm test -- --run tests/renderer-state.test.tsx
npm run typecheck
npm run build
```

Expected: the shell renders with mocked state, the event subscription cleans up, and the production renderer bundles.

- [ ] **Step 6: Commit the renderer shell**

```bash
git add src/renderer/hooks src/renderer/state.ts src/renderer/components src/renderer/App.tsx src/renderer/styles.css tests/renderer-state.test.tsx
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add Forgeboard renderer shell"
```

---

### Task 7: Implement workspace and prompt library workflows

**Files:**
- Create: `src/renderer/components/WorkspaceMenu.tsx`
- Create: `src/renderer/components/PromptList.tsx`
- Create: `src/renderer/components/PromptEditor.tsx`
- Create: `src/renderer/components/VariableFields.tsx`
- Create: `src/renderer/components/TagFilter.tsx`
- Create: `src/renderer/hooks/useKeyboardShortcuts.ts`
- Create: `tests/prompt-library.test.tsx`

**Interfaces:**
- `PromptList` receives prompts, search, selected ID, and selection callbacks.
- `PromptEditor` receives a `PromptDraft`, `onChange`, and `onSave`.
- `VariableFields` receives `variables: string[]`, `values: Record<string, string>`, and `onChange`.
- `useKeyboardShortcuts` binds search focus, new prompt, and run actions without capturing keys while a text field is active.

- [ ] **Step 1: Write prompt workflow tests**

Cover creating a prompt, editing title/body/tags, searching by title and tag, favoriting, detecting variables, showing missing-variable errors, saving a draft, and selecting a prompt from the list.

- [ ] **Step 2: Implement the prompt list and filters**

Render a semantic list with a search input, tag chips, favorite toggle, selected state, and an empty result message. Debounce only the visual filter input; keep the source array unchanged. Use stable keys based on prompt IDs.

- [ ] **Step 3: Implement the editor and variable fields**

The editor uses labeled inputs and a textarea. The variable field list is generated from `extractVariables(body)`, preserves entered values while the user edits, and marks blank fields as invalid. Saving calls `savePrompt` and selects the returned prompt ID.

- [ ] **Step 4: Implement workspace management**

Use a menu for create, rename, and delete. Require a non-empty name, show a confirmation dialog for deletion, and switch to another workspace when the active workspace is deleted. After each mutation, call the bridge and refresh state.

- [ ] **Step 5: Add keyboard shortcuts and focus behavior**

Bind `Ctrl/Cmd+K` to focus search, `Ctrl/Cmd+N` to create a prompt, and `Ctrl/Cmd+Enter` to run the current prompt. Ignore shortcuts when the target is an input, textarea, select, or contenteditable element.

- [ ] **Step 6: Run prompt tests and build**

```bash
npm test -- --run tests/prompt-library.test.tsx
npm run typecheck
npm run build
```

Expected: prompt CRUD and variable validation tests pass.

- [ ] **Step 7: Commit the prompt library**

```bash
git add src/renderer/components/WorkspaceMenu.tsx src/renderer/components/PromptList.tsx src/renderer/components/PromptEditor.tsx src/renderer/components/VariableFields.tsx src/renderer/components/TagFilter.tsx src/renderer/hooks/useKeyboardShortcuts.ts tests/prompt-library.test.tsx
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add prompt library workflows"
```

---

### Task 8: Add connections, request execution, history, and comparison views

**Files:**
- Create: `src/renderer/components/ConnectionDialog.tsx`
- Create: `src/renderer/components/RunPanel.tsx`
- Create: `src/renderer/components/ResponseViewer.tsx`
- Create: `src/renderer/components/HistoryList.tsx`
- Create: `src/renderer/components/ComparisonView.tsx`
- Create: `src/renderer/components/ErrorNotice.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Create: `tests/request-workflow.test.tsx`

**Interfaces:**
- `ConnectionDialog` accepts an optional existing connection and calls `saveConnection` with a transient credential value.
- `RunPanel` accepts selected connection, variables, prompt ID, and `onRun`/`onCancel` callbacks.
- `ResponseViewer` accepts a `RequestRecord`, an optional live text buffer, and an `onCompare` callback.
- `ComparisonView` accepts two `RequestRecord` values and displays model, duration, prompt, and response side by side.

- [ ] **Step 1: Write request workflow tests**

Mock a successful `runRequest`, emit a `started` event and two `delta` events, then assert the live response updates and the completed history item appears. Cover connection validation, cancel, authentication error, timeout error, and comparison selection.

- [ ] **Step 2: Implement the connection dialog**

Offer provider choices with these defaults:

```ts
const providerDefaults = {
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "llama3.2" },
  "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};
```

Validate the URL and model before saving. Keep the credential input masked, clear it after save, and show `hasCredential` as “Saved securely” only when the bridge reports it.

- [ ] **Step 3: Implement the run panel**

Render the selected provider, model, timeout, variable inputs, and a prominent run button. Disable duplicate submissions while a request is active. The cancel button calls `cancelRequest(requestId)` and leaves the prompt intact.

- [ ] **Step 4: Implement live response and error presentation**

Subscribe to `RunEvent` deltas through `useForgeboard`. Show a status pill for queued, running, completed, failed, and cancelled states. Render response text as text content, never raw HTML. `ErrorNotice` shows a friendly message, a retry action when retryable, and a collapsed safe technical detail.

- [ ] **Step 5: Implement history and comparison**

Group history by date, show provider/model/status/duration, allow selecting two records, and open a modal or split view for comparison. Make response text selectable and copyable with a button that reports success through an accessible live region.

- [ ] **Step 6: Run request tests and build**

```bash
npm test -- --run tests/request-workflow.test.tsx
npm run typecheck
npm run build
```

Expected: connection, streaming, cancellation, error, history, and comparison tests pass.

- [ ] **Step 7: Commit execution workflows**

```bash
git add src/renderer/components/ConnectionDialog.tsx src/renderer/components/RunPanel.tsx src/renderer/components/ResponseViewer.tsx src/renderer/components/HistoryList.tsx src/renderer/components/ComparisonView.tsx src/renderer/components/ErrorNotice.tsx src/renderer/App.tsx src/renderer/styles.css tests/request-workflow.test.tsx
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: add model connections and run history"
```

---

### Task 9: Add import/export, settings, accessibility polish, and end-to-end checks

**Files:**
- Create: `src/renderer/components/SettingsView.tsx`
- Create: `src/renderer/components/ImportExportControls.tsx`
- Create: `tests/settings-and-transfer.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/shared/serialization.ts`
- Modify: `src/shared/validation.ts`

**Interfaces:**
- `exportData()` returns `{ filename, contents }` and triggers a browser download through the renderer without exposing a filesystem path.
- `importData(contents)` returns an `ImportReport` containing imported counts and safe warnings.
- `updateSettings` accepts only `theme` and `defaultConnectionId`.
- Settings UI never displays an existing credential or a secret-bearing connection value.

- [ ] **Step 1: Write settings and transfer tests**

Assert theme changes, default connection selection, JSON download, Markdown prompt export, invalid import rejection, and recovery/warning rendering.

- [ ] **Step 2: Implement settings and transfer controls**

Add a settings view with theme buttons, a default model connection selector, an export button, an import file input, and a privacy explanation. Accept `.json` and `.md` files, read them in the renderer, and pass only file contents to the bridge. Show warnings without discarding the current workspace when an import fails.

- [ ] **Step 3: Add accessibility and visual polish**

Verify semantic headings, labels for every form field, `aria-live` status regions, focus restoration after dialogs, sufficient contrast, reduced-motion behavior, and responsive layouts at 320px, 768px, and 1280px widths. Ensure all destructive controls have confirmation and all icon-only controls have accessible names.

- [ ] **Step 4: Run the full local verification suite**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run dist:dir
```

Expected: every command exits successfully, the unpacked Electron application is generated, and no test requires an external model endpoint.

- [ ] **Step 5: Commit the release hardening**

```bash
git add src/renderer src/shared tests/settings-and-transfer.test.tsx
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "feat: harden settings and workspace transfers"
```

---

### Task 10: Add open-source documentation, CI, and packaging configuration

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `electron-builder.yml`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- `npm run dist` produces platform-appropriate installers.
- CI runs on pushes and pull requests and validates the same commands contributors run locally.
- README commands match the actual package scripts exactly.

- [ ] **Step 1: Write the README**

Include a concise product description, feature list, privacy statement, supported provider setup, `npm install`, `npm run dev`, `npm test`, `npm run build`, `npm run dist`, project structure, contribution link, security link, and roadmap. Clearly state that remote prompts are sent only to the selected provider when the user runs a request.

- [ ] **Step 2: Add repository governance files**

Add the MIT license text, a contribution guide with setup and test expectations, a security policy requesting private disclosure for vulnerabilities, and a Contributor Covenant-style code of conduct. Do not include personal data or real credentials in any example.

- [ ] **Step 3: Add electron-builder configuration**

Configure `appId`, product name, artifact directory, and Windows/macOS/Linux targets. Ensure the packaged app includes the built main, preload, and renderer output and does not include test fixtures or local data.

- [ ] **Step 4: Add GitHub Actions CI**

Use Node.js 22.22.2 or newer with `npm ci`, then run:

```yaml
- run: npm run lint
- run: npm run typecheck
- run: npm test
- run: npm run build
```

Cache the npm dependency directory. Do not run packaging on every pull request unless the workflow has the required platform permissions and signing setup.

- [ ] **Step 5: Run the final verification and commit documentation**

```bash
npm run lint
npm run typecheck
npm test
npm run build
git add README.md LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md electron-builder.yml .github/workflows/ci.yml package.json package-lock.json
git -c user.name="OpenCode" -c user.email="opencode@localhost" commit -m "docs: prepare Forgeboard open source release"
```

Expected: all checks pass and the repository is ready to publish after the maintainer adds their preferred signing and release configuration.

---

## Plan self-review

- **Spec coverage:** Tasks 1–2 cover the toolchain, process boundaries, records, variables, errors, and serialization. Tasks 3–5 cover atomic persistence, backups, credentials, providers, streaming, cancellation, and IPC security. Tasks 6–8 cover the renderer, workspaces, prompt library, connections, runs, history, comparison, and privacy UX. Tasks 9–10 cover import/export, accessibility, tests, documentation, CI, packaging, and the MIT release requirements.
- **Placeholder scan:** The plan contains no incomplete markers or deferred requirements. Every task names concrete files, interfaces, commands, expected outcomes, and a commit.
- **Type consistency:** `StoreDocument`, `AppState`, `Prompt`, `Connection`, `RequestRecord`, `RunEvent`, `AppError`, `ForgeboardApi`, `CredentialVault`, `ProviderAdapter`, and `RequestService` names are used consistently across tasks. The renderer consumes only the `ForgeboardApi` methods introduced in Task 5.
- **Scope check:** The plan keeps v1 to a usable local-first prompt library and model playground. Automatic cloud sync, accounts, agents, plugins, and arbitrary command execution remain explicitly out of scope.
