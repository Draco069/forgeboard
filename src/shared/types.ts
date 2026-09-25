import type { AppError } from "./errors";

export type ProviderKind = "ollama" | "openai-compatible";
export type RequestStatus = "success" | "error" | "cancelled";
export type Theme = "system" | "light" | "dark";

export interface AppPing {
  app: string;
  version: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Prompt {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptDraft {
  title: string;
  description: string;
  body: string;
  tags: string[];
  favorite: boolean;
}

export interface Connection {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestRecord {
  id: string;
  workspaceId: string;
  promptId?: string;
  connectionId: string;
  provider: ProviderKind;
  model: string;
  renderedPrompt: string;
  response: string;
  status: RequestStatus;
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
  /** True when the source connection was removed but history was retained. */
  retained?: boolean;
}

interface RunEventBase {
  requestId: string;
}

export type RunEvent =
  | (RunEventBase & {
      type: "started";
      createdAt: string;
      workspaceId: string;
      promptId?: string;
      connectionId: string;
      provider: ProviderKind;
      model: string;
    })
  | (RunEventBase & {
      type: "delta";
      text: string;
    })
  | (RunEventBase & {
      type: "completed";
      record: RequestRecord;
    })
  | (RunEventBase & {
      type: "error";
      error: AppError;
      record: RequestRecord;
    })
  | (RunEventBase & {
      type: "cancelled";
      record: RequestRecord;
    });

export interface Settings {
  theme: Theme;
  defaultConnectionId?: string;
}

export interface StoreDocument {
  schemaVersion: 1;
  workspaces: Workspace[];
  prompts: Prompt[];
  connections: Connection[];
  requests: RequestRecord[];
  settings: Settings;
  activeWorkspaceId: string;
}

export interface LoadResult {
  document: StoreDocument;
  recoveryNotice?: string;
}

export interface ImportCounts {
  workspaces: number;
  prompts: number;
  connections: number;
  requests: number;
}

export interface ImportReport {
  counts: ImportCounts;
  warnings: string[];
}

export interface AppState {
  document: StoreDocument;
  activeWorkspace: Workspace;
  recoveryNotice?: string;
  credentialsAvailable: boolean;
}

export interface WorkspaceCreateInput {
  name: string;
}

export interface WorkspaceRenameInput {
  id: string;
  name: string;
}

export interface RecordIdInput {
  id: string;
}

export interface PromptSaveInput {
  id?: string;
  workspaceId?: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
  favorite: boolean;
}

export interface ConnectionSaveInput {
  id?: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** Transient value used only by the main-process credential vault. */
  credential?: string;
}

export interface SettingsUpdateInput {
  theme?: Theme;
  defaultConnectionId?: string;
}

export interface RunRequestInput {
  workspaceId?: string;
  promptId?: string;
  connectionId: string;
  renderedPrompt: string;
  stream?: boolean;
  timeoutMs?: number;
}

export interface CancelRequestInput {
  requestId: string;
}

export interface ExportData {
  filename: string;
  contents: string;
}

export type IpcSuccess<T> = {
  ok: true;
  value: T;
};

export type IpcFailure = {
  ok: false;
  error: AppError;
};

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

/** Alias retained for consumers that describe an IPC envelope as a response. */
export type IpcResponse<T> = IpcResult<T>;

export type RunEventListener = (event: RunEvent) => void;

export interface ForgeboardApi {
  getState(): Promise<AppState>;
  createWorkspace(name: string): Promise<Workspace>;
  createWorkspace(input: WorkspaceCreateInput): Promise<Workspace>;
  renameWorkspace(id: string, name: string): Promise<Workspace>;
  renameWorkspace(input: WorkspaceRenameInput): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<Workspace>;
  deleteWorkspace(input: RecordIdInput): Promise<Workspace>;
  setActiveWorkspace(id: string): Promise<Workspace>;
  setActiveWorkspace(input: RecordIdInput): Promise<Workspace>;
  savePrompt(input: PromptSaveInput): Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;
  deletePrompt(input: RecordIdInput): Promise<void>;
  saveConnection(input: ConnectionSaveInput): Promise<Connection>;
  deleteConnection(id: string): Promise<void>;
  deleteConnection(input: RecordIdInput): Promise<void>;
  updateSettings(input: SettingsUpdateInput): Promise<Settings>;
  runRequest(input: RunRequestInput): Promise<RequestRecord>;
  cancelRequest(requestId: string): Promise<boolean>;
  cancelRequest(input: CancelRequestInput): Promise<boolean>;
  exportData(): Promise<ExportData>;
  importData(contents: string): Promise<ImportReport>;
  onRunEvent(listener: RunEventListener): () => void;
  ping(): Promise<AppPing>;
}

export type { AppError, AppErrorCode } from "./errors";
