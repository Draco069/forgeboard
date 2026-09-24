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
  provider: string;
  model: string;
  renderedPrompt: string;
  response: string;
  status: RequestStatus;
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
}

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

export interface AppState {
  document: StoreDocument;
  activeWorkspace: Workspace;
  recoveryNotice?: string;
  credentialsAvailable: boolean;
}

export type { AppError, AppErrorCode } from "./errors";
