import { app, ipcMain } from "electron";
import {
  APP_ERROR_CODES,
  createValidationError,
  normalizeAppError,
  redactSecrets,
} from "../shared/errors";
import type {
  AppError,
  CancelRequestInput,
  ConnectionSaveInput,
  IpcFailure,
  IpcResult,
  RecordIdInput,
  RequestRecord,
  RunEvent,
  RunRequestInput,
  WorkspaceCreateInput,
  WorkspaceRenameInput,
} from "../shared/types";
import {
  appPingSchema,
  appStateSchema,
  cancelRequestInputSchema,
  connectionSchema,
  connectionSaveInputSchema,
  emptyInputSchema,
  exportDataSchema,
  importDataPayloadSchema,
  importReportSchema,
  promptSaveInputSchema,
  recordIdInputSchema,
  requestRecordSchema,
  runRequestInputSchema,
  settingsUpdateInputSchema,
  settingsSchema,
  workspaceCreateInputSchema,
  workspaceRenameInputSchema,
  workspaceSchema,
  promptSchema,
} from "../shared/validation";
import type { CredentialVaultContract } from "./credentials";
import type { ForgeboardStore } from "./store";
import type { RequestService } from "./request-service";
import type { ZodType } from "zod";

export const IPC_CHANNELS = {
  appPing: "app:ping",
  stateGet: "state:get",
  workspaceCreate: "workspace:create",
  workspaceRename: "workspace:rename",
  workspaceDelete: "workspace:delete",
  workspaceSetActive: "workspace:set-active",
  promptSave: "prompt:save",
  promptDelete: "prompt:delete",
  connectionSave: "connection:save",
  connectionDelete: "connection:delete",
  settingsUpdate: "settings:update",
  requestRun: "request:run",
  requestCancel: "request:cancel",
  dataExport: "data:export",
  dataImport: "data:import",
} as const;

export const RUN_EVENT_CHANNEL = "request:event";

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcWindow {
  isDestroyed?: () => boolean;
  webContents: {
    isDestroyed?: () => boolean;
    send: (channel: string, payload: unknown) => void;
  };
}

export type GetWindow = () => IpcWindow | null | undefined;

export interface IpcMainLike {
  handle(
    channel: IpcChannel,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
}

export interface IpcHandlerDependencies {
  store: ForgeboardStore;
  credentials: CredentialVaultContract;
  requestService: RequestService;
  getWindow: GetWindow;
  /** Injectable for focused tests; production uses Electron's app version. */
  getVersion?: () => string;
  /** Injectable for focused tests; production uses Electron's ipcMain. */
  ipcMain?: IpcMainLike;
}

export type IpcHandler = (
  event: unknown,
  ...args: unknown[]
) => Promise<IpcResult<unknown>>;

export type IpcHandlerMap = Record<IpcChannel, IpcHandler>;

const WINDOWS_DRIVE_PATH = /[A-Za-z]:\\/;
const WINDOWS_DRIVE_SLASH = /[A-Za-z]:\//;
const WINDOWS_UNC_PATH = /^\\\\/;
const RELATIVE_FILESYSTEM_PATH = /(?:^|[\s("'`])\.\.?[\\/]/;
const UNIX_ABSOLUTE_PATH = /(?:^|[\s("'`])\/(?!\/)[^\s"'<>]+/;
const PROVIDER_ERROR_PREFIX = /provider returned an error\s*:\s*/i;
const RESPONSE_BODY_MARKER =
  /(?:response\s*body|<\/?html|["']?error["']?\s*:|^\s*\{\s*["']|^\s*\[\s*["'{])/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isStructuredAppError(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.code === "string" &&
      APP_ERROR_CODES.includes(record.code as (typeof APP_ERROR_CODES)[number]) &&
      typeof record.retryable === "boolean",
  );
}

function sanitizeErrorDetail(
  detail: string | undefined,
  code: AppError["code"],
  secrets: string[],
  structured: boolean,
): string | undefined {
  if (!detail || !structured) {
    return undefined;
  }

  const safeDetail = redactSecrets(detail, secrets);
  if (
    WINDOWS_DRIVE_PATH.test(safeDetail) ||
    WINDOWS_DRIVE_SLASH.test(safeDetail) ||
    WINDOWS_UNC_PATH.test(safeDetail) ||
    RELATIVE_FILESYSTEM_PATH.test(safeDetail) ||
    UNIX_ABSOLUTE_PATH.test(safeDetail)
  ) {
    return "[REDACTED_PATH]";
  }

  if (code === "PROVIDER" && PROVIDER_ERROR_PREFIX.test(safeDetail)) {
    return "The provider returned an error.";
  }
  if (RESPONSE_BODY_MARKER.test(safeDetail)) {
    return undefined;
  }

  return safeDetail.slice(0, 2_000);
}

function serializeIpcErrorValue(
  error: unknown,
  structured: boolean,
  secrets: string[],
): AppError {
  const normalized = normalizeAppError(error, secrets);
  const structuredRecord = asRecord(error);
  const structuredDetail =
    typeof structuredRecord?.detail === "string" ? structuredRecord.detail : undefined;
  const detail = sanitizeErrorDetail(
    structured ? structuredDetail : normalized.detail,
    normalized.code,
    secrets,
    structured,
  );
  return {
    code: normalized.code,
    message: normalized.message,
    ...(structured && detail ? { detail } : {}),
    retryable: normalized.retryable,
  };
}

/** Converts any boundary failure into a plain, structured-clone-safe value. */
export function serializeIpcError(error: unknown, secrets: string[] = []): AppError {
  return serializeIpcErrorValue(error, isStructuredAppError(error), secrets);
}

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function failure(error: AppError): IpcFailure {
  return { ok: false, error };
}

function parseValue<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw createValidationError(`${label} is invalid.`);
  }
  return result.data;
}

function parseNoInput(args: unknown[]): void {
  if (args.length > 1 || (args.length === 1 && args[0] !== undefined)) {
    throw createValidationError("This operation does not accept input.");
  }
  parseValue(emptyInputSchema, undefined, "Input");
}

function parseSingle<T>(schema: ZodType<T>, args: unknown[], label: string): T {
  if (args.length !== 1) {
    throw createValidationError(`${label} requires one input value.`);
  }
  return parseValue(schema, args[0], label);
}

function parseWorkspaceCreate(args: unknown[]): WorkspaceCreateInput {
  if (args.length !== 1) {
    throw createValidationError("Workspace creation requires one input value.");
  }
  if (typeof args[0] === "string") {
    return parseValue(workspaceCreateInputSchema, { name: args[0] }, "Workspace");
  }
  return parseValue(workspaceCreateInputSchema, args[0], "Workspace");
}

function parseWorkspaceRename(args: unknown[]): WorkspaceRenameInput {
  if (args.length === 2) {
    return parseValue(
      workspaceRenameInputSchema,
      { id: args[0], name: args[1] },
      "Workspace",
    );
  }
  return parseSingle(workspaceRenameInputSchema, args, "Workspace");
}

function parseRecordId(args: unknown[], label: string): string {
  if (args.length !== 1) {
    throw createValidationError(`${label} requires one input value.`);
  }
  const value = typeof args[0] === "string" ? { id: args[0] } : args[0];
  const parsed = parseValue<RecordIdInput>(recordIdInputSchema, value, label);
  return parsed.id;
}

function parseCancelRequest(args: unknown[]): CancelRequestInput {
  if (args.length !== 1) {
    throw createValidationError("Request cancellation requires one input value.");
  }
  if (typeof args[0] === "string") {
    return parseValue(cancelRequestInputSchema, { requestId: args[0] }, "Request");
  }
  return parseValue(cancelRequestInputSchema, args[0], "Request");
}

function parseImportData(args: unknown[]): string {
  if (args.length !== 1) {
    throw createValidationError("Import data requires one input value.");
  }
  const value = parseValue(importDataPayloadSchema, args[0], "Import data");
  return typeof value === "string" ? value : value.contents;
}

async function execute<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return success(await operation());
  } catch (error) {
    return failure(serializeIpcError(error));
  }
}

async function credentialSecrets(
  credentials: CredentialVaultContract,
  connectionId: string | undefined,
): Promise<string[]> {
  if (!connectionId) {
    return [];
  }
  try {
    const credential = await credentials.get(connectionId);
    return credential ? [credential] : [];
  } catch {
    return [];
  }
}

function windowCanReceive(window: IpcWindow | null | undefined): window is IpcWindow {
  if (!window) {
    return false;
  }
  try {
    if (window.isDestroyed?.()) {
      return false;
    }
    return !window.webContents.isDestroyed?.();
  } catch {
    return false;
  }
}

function safeRequestRecord(value: RequestRecord): RequestRecord {
  const record = requestRecordSchema.parse(value);
  if (!record.errorMessage) {
    return record;
  }

  const safeMessage = sanitizeErrorDetail(record.errorMessage, "PROVIDER", [], true);
  return {
    ...record,
    errorMessage: safeMessage ?? "The request failed.",
  };
}

function safeRunEvent(value: unknown): RunEvent | undefined {
  const record = asRecord(value);
  if (!record || typeof record.requestId !== "string" || record.requestId.length === 0) {
    return undefined;
  }

  try {
    switch (record.type) {
      case "started": {
        if (
          typeof record.createdAt !== "string" ||
          typeof record.workspaceId !== "string" ||
          typeof record.connectionId !== "string" ||
          (record.provider !== "ollama" && record.provider !== "openai-compatible") ||
          typeof record.model !== "string" ||
          (record.promptId !== undefined && typeof record.promptId !== "string")
        ) {
          return undefined;
        }
        return {
          type: "started",
          requestId: record.requestId,
          createdAt: record.createdAt,
          workspaceId: record.workspaceId,
          ...(record.promptId ? { promptId: record.promptId } : {}),
          connectionId: record.connectionId,
          provider: record.provider,
          model: record.model,
        };
      }
      case "delta": {
        if (typeof record.text !== "string") {
          return undefined;
        }
        return {
          type: "delta",
          requestId: record.requestId,
          text: record.text,
        };
      }
      case "completed":
      case "cancelled": {
        const request = safeRequestRecord(record.record as RequestRecord);
        return {
          type: record.type,
          requestId: record.requestId,
          record: request,
        };
      }
      case "error": {
        const request = safeRequestRecord(record.record as RequestRecord);
        return {
          type: "error",
          requestId: record.requestId,
          error: serializeIpcError(record.error),
          record: request,
        };
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function createRunEventEmitter(getWindow: GetWindow): (event: unknown) => void {
  return (event: unknown) => {
    try {
      const window = getWindow();
      const safeEvent = safeRunEvent(event);
      if (!windowCanReceive(window) || !safeEvent) {
        return;
      }
      window.webContents.send(RUN_EVENT_CHANNEL, safeEvent);
    } catch {
      // A window can disappear between the guard and send. The request itself
      // must continue and persist its normalized result.
    }
  };
}

function output<T>(schema: ZodType<T>, value: T): T {
  return parseValue(schema, value, "Operation result");
}

function appVersion(getVersion?: () => string): string {
  if (getVersion) {
    return getVersion();
  }
  try {
    return app.getVersion();
  } catch {
    return "unknown";
  }
}

/** Builds the complete validated handler set without touching Electron globals. */
export function createIpcHandlers(
  dependencies: IpcHandlerDependencies,
): IpcHandlerMap {
  const { store, credentials, requestService, getWindow } = dependencies;
  const emitRunEvent = createRunEventEmitter(getWindow);

  const handlers: IpcHandlerMap = {
    [IPC_CHANNELS.appPing]: async (_event, ...args) => {
      try {
        parseNoInput(args);
        return success(
          output(appPingSchema, {
            app: "Forgeboard",
            version: appVersion(dependencies.getVersion),
          }),
        );
      } catch (error) {
        return failure(serializeIpcError(error));
      }
    },

    [IPC_CHANNELS.stateGet]: async (_event, ...args) =>
      execute(() => {
        parseNoInput(args);
        return output(appStateSchema, store.getState());
      }),

    [IPC_CHANNELS.workspaceCreate]: async (_event, ...args) =>
      execute(async () => {
        const input = parseWorkspaceCreate(args);
        return output(workspaceSchema, await store.createWorkspace(input.name));
      }),

    [IPC_CHANNELS.workspaceRename]: async (_event, ...args) =>
      execute(async () => {
        const input = parseWorkspaceRename(args);
        return output(workspaceSchema, await store.renameWorkspace(input.id, input.name));
      }),

    [IPC_CHANNELS.workspaceDelete]: async (_event, ...args) =>
      execute(async () => {
        const id = parseRecordId(args, "Workspace");
        return output(workspaceSchema, await store.deleteWorkspace(id));
      }),

    [IPC_CHANNELS.workspaceSetActive]: async (_event, ...args) =>
      execute(async () => {
        const id = parseRecordId(args, "Workspace");
        return output(workspaceSchema, await store.setActiveWorkspace(id));
      }),

    [IPC_CHANNELS.promptSave]: async (_event, ...args) =>
      execute(async () => {
        const input = parseSingle(
          promptSaveInputSchema,
          args,
          "Prompt",
        );
        return output(promptSchema, await store.savePrompt(input));
      }),

    [IPC_CHANNELS.promptDelete]: async (_event, ...args) =>
      execute(async () => {
        const id = parseRecordId(args, "Prompt");
        await store.deletePrompt(id);
        return undefined;
      }),

    [IPC_CHANNELS.connectionSave]: async (_event, ...args) => {
      let input: ConnectionSaveInput | undefined;
      try {
        input = parseSingle(connectionSaveInputSchema, args, "Connection");
        return success(
          output(connectionSchema, await store.saveConnection(input)),
        );
      } catch (error) {
        return failure(serializeIpcError(error, input?.credential ? [input.credential] : []));
      }
    },

    [IPC_CHANNELS.connectionDelete]: async (_event, ...args) =>
      execute(async () => {
        const id = parseRecordId(args, "Connection");
        await store.deleteConnection(id);
        return undefined;
      }),

    [IPC_CHANNELS.settingsUpdate]: async (_event, ...args) =>
      execute(async () => {
        const input = parseSingle(settingsUpdateInputSchema, args, "Settings");
        return output(settingsSchema, await store.updateSettings(input));
      }),

    [IPC_CHANNELS.requestRun]: async (_event, ...args) => {
      let input: RunRequestInput | undefined;
      try {
        input = parseSingle(runRequestInputSchema, args, "Request");
        const record = await requestService.run(input, emitRunEvent);
        return success(output(requestRecordSchema, safeRequestRecord(record)));
      } catch (error) {
        const secrets = await credentialSecrets(credentials, input?.connectionId);
        return failure(serializeIpcError(error, secrets));
      }
    },

    [IPC_CHANNELS.requestCancel]: async (_event, ...args) =>
      execute(() => {
        const input = parseCancelRequest(args);
        return requestService.cancel(input.requestId);
      }),

    [IPC_CHANNELS.dataExport]: async (_event, ...args) =>
      execute(() => {
        parseNoInput(args);
        return output(exportDataSchema, store.exportData());
      }),

    [IPC_CHANNELS.dataImport]: async (_event, ...args) =>
      execute(async () => {
        const contents = parseImportData(args);
        return output(importReportSchema, await store.importData(contents));
      }),
  };

  return handlers;
}

/** Registers only the fixed, named channels used by the preload bridge. */
export function registerIpcHandlers(
  dependencies: IpcHandlerDependencies,
): IpcHandlerMap {
  const handlers = createIpcHandlers(dependencies);
  const target = dependencies.ipcMain ?? (ipcMain as unknown as IpcMainLike);

  for (const channel of Object.values(IPC_CHANNELS)) {
    target.handle(channel, handlers[channel]);
  }

  return handlers;
}
