import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { APP_ERROR_CODES, createAppError } from "../shared/errors";
import type {
  AppError,
  AppPing,
  CancelRequestInput,
  Connection,
  ForgeboardApi,
  ImportReport,
  IpcResult,
  Prompt,
  RecordIdInput,
  RequestRecord,
  RunEvent,
  RunEventListener,
  RunRequestInput,
  Settings,
  SettingsUpdateInput,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceRenameInput,
  ConnectionSaveInput,
  PromptSaveInput,
} from "../shared/types";

const CHANNELS = {
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

const RUN_EVENT_CHANNEL = "request:event";

type IpcChannel = (typeof CHANNELS)[keyof typeof CHANNELS];

function isSerializedAppError(value: unknown): value is AppError {
  if (value instanceof Error || typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    APP_ERROR_CODES.includes(record.code as (typeof APP_ERROR_CODES)[number]) &&
    typeof record.message === "string" &&
    (record.detail === undefined || typeof record.detail === "string") &&
    typeof record.retryable === "boolean"
  );
}

function isIpcResult(value: unknown): value is IpcResult<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return "value" in record;
  }
  return record.ok === false && isSerializedAppError(record.error);
}

function isRawError(value: unknown): boolean {
  if (value instanceof Error) {
    return true;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.stack === "string" && typeof record.message === "string";
}

function copySerializedAppError(error: AppError): AppError {
  return {
    code: error.code,
    message: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
    retryable: error.retryable,
  };
}

function invalidBridgeResponse(): AppError {
  return createAppError("UNKNOWN", "The local bridge returned an invalid response.");
}

async function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  let result: unknown;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    if (isSerializedAppError(error)) {
      throw copySerializedAppError(error);
    }
    throw invalidBridgeResponse();
  }

  if (!isIpcResult(result)) {
    throw invalidBridgeResponse();
  }
  if (result.ok) {
    if (isRawError(result.value)) {
      throw invalidBridgeResponse();
    }
    return result.value as T;
  }
  throw copySerializedAppError(result.error);
}

function createWorkspace(
  nameOrInput: string | WorkspaceCreateInput,
): Promise<Workspace> {
  return invoke(CHANNELS.workspaceCreate, nameOrInput);
}

function renameWorkspace(
  idOrInput: string | WorkspaceRenameInput,
  name?: string,
): Promise<Workspace> {
  return name === undefined
    ? invoke(CHANNELS.workspaceRename, idOrInput)
    : invoke(CHANNELS.workspaceRename, idOrInput, name);
}

function deleteWorkspace(idOrInput: string | RecordIdInput): Promise<Workspace> {
  return invoke(CHANNELS.workspaceDelete, idOrInput);
}

function setActiveWorkspace(idOrInput: string | RecordIdInput): Promise<Workspace> {
  return invoke(CHANNELS.workspaceSetActive, idOrInput);
}

function savePrompt(input: PromptSaveInput): Promise<Prompt> {
  return invoke(CHANNELS.promptSave, input);
}

function deletePrompt(idOrInput: string | RecordIdInput): Promise<void> {
  return invoke(CHANNELS.promptDelete, idOrInput);
}

function saveConnection(input: ConnectionSaveInput): Promise<Connection> {
  return invoke(CHANNELS.connectionSave, input);
}

function deleteConnection(idOrInput: string | RecordIdInput): Promise<void> {
  return invoke(CHANNELS.connectionDelete, idOrInput);
}

function updateSettings(input: SettingsUpdateInput): Promise<Settings> {
  return invoke(CHANNELS.settingsUpdate, input);
}

function runRequest(input: RunRequestInput): Promise<RequestRecord> {
  return invoke(CHANNELS.requestRun, input);
}

function cancelRequest(requestIdOrInput: string | CancelRequestInput): Promise<boolean> {
  return invoke(CHANNELS.requestCancel, requestIdOrInput);
}

const forgeboardApi: ForgeboardApi = {
  ping: (): Promise<AppPing> => invoke(CHANNELS.appPing),
  getState: () => invoke(CHANNELS.stateGet),
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  setActiveWorkspace,
  savePrompt,
  deletePrompt,
  saveConnection,
  deleteConnection,
  updateSettings,
  runRequest,
  cancelRequest,
  exportData: () => invoke(CHANNELS.dataExport),
  importData: (contents: string): Promise<ImportReport> =>
    invoke(CHANNELS.dataImport, contents),
  onRunEvent: (listener: RunEventListener): (() => void) => {
    if (typeof listener !== "function") {
      throw invalidBridgeResponse();
    }
    const handler = (_event: IpcRendererEvent, payload: RunEvent): void => {
      try {
        listener(payload);
      } catch {
        // Renderer listeners must not break the IPC event channel.
      }
    };
    try {
      ipcRenderer.on(RUN_EVENT_CHANNEL, handler);
    } catch {
      throw invalidBridgeResponse();
    }
    return () => {
      try {
        ipcRenderer.removeListener(RUN_EVENT_CHANNEL, handler);
      } catch {
        // Unsubscribing is best effort after a renderer/window teardown.
      }
    };
  },
};

contextBridge.exposeInMainWorld("forgeboard", forgeboardApi);
