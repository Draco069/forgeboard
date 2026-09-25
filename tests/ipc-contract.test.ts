import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CredentialVault } from "../src/main/credentials";
import { createDefaultDocument } from "../src/main/defaults";
import { AppErrorException, createAppError } from "../src/shared/errors";
import {
  createIpcHandlers,
  IPC_CHANNELS,
  registerIpcHandlers,
  type IpcHandlerDependencies,
  type IpcWindow,
} from "../src/main/ipc";
import type { RequestService } from "../src/main/request-service";
import type { ForgeboardStore } from "../src/main/store";
import type { AppState, RunEvent, RunRequestInput } from "../src/shared/types";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.1.0" },
  ipcMain: { handle: vi.fn() },
}));

function createState(): AppState {
  const document = createDefaultDocument();
  return {
    document,
    activeWorkspace: document.workspaces[0],
    credentialsAvailable: true,
  };
}

function createDependencies(
  overrides: Partial<IpcHandlerDependencies> = {},
): IpcHandlerDependencies {
  const state = createState();
  const store = {
    getState: vi.fn(() => state),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    setActiveWorkspace: vi.fn(),
    savePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    saveConnection: vi.fn(),
    deleteConnection: vi.fn(),
    updateSettings: vi.fn(),
    importData: vi.fn(),
    exportData: vi.fn(),
  } as unknown as ForgeboardStore;
  const credentials = {
    has: vi.fn().mockResolvedValue(false),
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
  } satisfies CredentialVault;
  const requestService = {
    run: vi.fn(),
    cancel: vi.fn().mockReturnValue(false),
  } as unknown as RequestService;

  return {
    store,
    credentials,
    requestService,
    getWindow: () => undefined,
    getVersion: () => "0.1.0",
    ...overrides,
  };
}

describe("Forgeboard IPC contract", () => {
  it("exposes only the typed renderer allowlist", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/preload/index.ts"),
      "utf8",
    );
    const objectStart = source.indexOf("const forgeboardApi: ForgeboardApi = {");
    const objectEnd = source.indexOf("\n};", objectStart);
    expect(objectStart).toBeGreaterThanOrEqual(0);
    expect(objectEnd).toBeGreaterThan(objectStart);

    const methods = [...source.slice(objectStart, objectEnd).matchAll(/^\s{2}(\w+)(?::|,)/gm)].map(
      ([, method]) => method,
    );
    expect(methods).toEqual([
      "ping",
      "getState",
      "createWorkspace",
      "renameWorkspace",
      "deleteWorkspace",
      "setActiveWorkspace",
      "savePrompt",
      "deletePrompt",
      "saveConnection",
      "deleteConnection",
      "updateSettings",
      "runRequest",
      "cancelRequest",
      "exportData",
      "importData",
      "onRunEvent",
    ]);

    expect(source).toContain('contextBridge.exposeInMainWorld("forgeboard", forgeboardApi)');
    expect(source).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer\b/);
  });

  it("registers only the fixed IPC channels", () => {
    const handle = vi.fn();
    const dependencies = createDependencies({ ipcMain: { handle } });

    registerIpcHandlers(dependencies);

    expect(handle.mock.calls.map(([channel]) => channel)).toEqual(
      Object.values(IPC_CHANNELS),
    );
  });

  it("does not put Node, process, or filesystem access in preload", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/preload/index.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bprocess\b/);
    expect(source).not.toMatch(/\b(?:node:fs|fs|readFile|writeFile|readdir|join)\b/);
    expect(source).not.toMatch(/exposeInMainWorld\([^,]+,\s*(?:ipcRenderer|require|process)\b/);
  });

  it("retains the main-process isolation and startup boundaries", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(source).toContain("contextIsolation: true");
    expect(source).toContain("nodeIntegration: false");
    expect(source).toContain("sandbox: true");
    expect(source).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(source).toContain('"will-navigate"');
    expect(source).toContain('"will-redirect"');
    expect(source.indexOf("await store.load()")).toBeLessThan(
      source.indexOf("registerIpcHandlers({"),
    );
  });

  it("validates before invoking a store operation and returns a plain error", async () => {
    const dependencies = createDependencies();
    const handlers = createIpcHandlers(dependencies);

    const invalid = await handlers[IPC_CHANNELS.workspaceCreate]({}, { name: "" });

    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", retryable: false },
    });
    expect(dependencies.store.createWorkspace).not.toHaveBeenCalled();

    const secret = "untrusted-secret-value";
    const failingDependencies = createDependencies({
      store: {
        createWorkspace: vi.fn().mockRejectedValue(new Error(`failed ${secret} at C:\\Users\\test`)),
      } as unknown as ForgeboardStore,
    });
    const failingHandlers = createIpcHandlers(failingDependencies);
    const failed = await failingHandlers[IPC_CHANNELS.workspaceCreate]({}, { name: "Team" });

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).not.toBeInstanceOf(Error);
      expect(JSON.stringify(failed.error)).not.toContain(secret);
      expect(JSON.stringify(failed.error)).not.toContain("C:\\Users\\test");
    }
  });

  it("preserves the structured AppError fields at the boundary", async () => {
    const dependencies = createDependencies({
      store: {
        createWorkspace: vi
          .fn()
          .mockRejectedValue(
            new AppErrorException(createAppError("VALIDATION", "The workspace name is invalid.")),
          ),
      } as unknown as ForgeboardStore,
    });
    const handlers = createIpcHandlers(dependencies);

    const result = await handlers[IPC_CHANNELS.workspaceCreate]({}, { name: "Team" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Please check the input and try again.",
        detail: "The workspace name is invalid.",
        retryable: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBeInstanceOf(Error);
    }
  });

  it("guards request event delivery against a destroyed window", async () => {
    const state = createState();
    const record = {
      id: "request-1",
      workspaceId: state.activeWorkspace.id,
      connectionId: "connection-1",
      provider: "ollama" as const,
      model: "llama3.2",
      renderedPrompt: "hello",
      response: "done",
      status: "success" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const send = vi.fn();
    const requestService = {
      run: vi.fn(async (_input: RunRequestInput, emit: (event: RunEvent) => void) => {
        emit({
          type: "started",
          requestId: record.id,
          createdAt: record.createdAt,
          workspaceId: record.workspaceId,
          connectionId: record.connectionId,
          provider: record.provider,
          model: record.model,
        });
        return record;
      }),
      cancel: vi.fn(),
    } as unknown as RequestService;
    const window: IpcWindow = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => false, send },
    };
    const dependencies = createDependencies({ requestService, getWindow: () => window });
    const handlers = createIpcHandlers(dependencies);

    const result = await handlers[IPC_CHANNELS.requestRun]({}, {
      connectionId: record.connectionId,
      renderedPrompt: "hello",
    });

    expect(result).toMatchObject({ ok: true, value: { id: record.id } });
    expect(send).not.toHaveBeenCalled();
  });
});
