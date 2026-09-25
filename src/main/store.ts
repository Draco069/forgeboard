import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  AppErrorException,
  createAppError,
  createValidationError,
} from "../shared/errors";
import { serializeSnapshot } from "../shared/serialization";
import type {
  AppState,
  Connection,
  ImportCounts,
  ImportReport,
  LoadResult,
  Prompt,
  PromptDraft,
  RequestRecord,
  Settings,
  StoreDocument,
  Workspace,
} from "../shared/types";
import {
  connectionSchema,
  migrateStoreDocument,
  parseStoreDocument,
  promptDraftSchema,
  promptSchema,
  requestRecordSchema,
  settingsSchema,
  workspaceSchema,
} from "../shared/validation";
import type { StoreMigration } from "../shared/validation";
import type { CredentialVaultContract } from "./credentials";
import { createDefaultDocument } from "./defaults";

const STORE_FILE_NAME = "forgeboard.json";
const BACKUP_DIRECTORY_NAME = "backups";
const BACKUP_COUNT = 3;
const TEMPORARY_FILE_SUFFIX = ".tmp";
// The connection draft shares the persisted-record schema, so use a valid
// placeholder timestamp.
const DRAFT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export interface StoreFileHandle {
  writeFile(data: string, encoding?: "utf8"): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface StoreFileSystem {
  mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding?: "utf8"): Promise<unknown>;
  open?(path: string, flags: "w", mode?: number): Promise<StoreFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ForgeboardStoreOptions {
  fileSystem?: Partial<StoreFileSystem>;
  now?: () => string;
  idFactory?: () => string;
  migrations?: Readonly<Record<number, StoreMigration>>;
}

export interface PromptSaveInput extends PromptDraft {
  id?: string;
  workspaceId?: string;
}

export interface ConnectionSaveInput {
  id?: string;
  name: string;
  provider: Connection["provider"];
  baseUrl: string;
  model: string;
  /** Transient value; it is never stored in StoreDocument. */
  credential?: string;
}

export interface RequestSaveInput {
  id?: string;
  workspaceId: string;
  promptId?: string;
  connectionId: string;
  provider: RequestRecord["provider"];
  model: string;
  renderedPrompt: string;
  response: string;
  status: RequestRecord["status"];
  errorMessage?: string;
  durationMs?: number;
  createdAt?: string;
  retained?: boolean;
}

export interface ExportData {
  filename: string;
  contents: string;
}

const defaultFileSystem: StoreFileSystem = {
  mkdir: (path, options) => nodeFs.mkdir(path, options),
  readFile: (path, encoding) => nodeFs.readFile(path, encoding),
  writeFile: (path, data, encoding) => nodeFs.writeFile(path, data, encoding),
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode);
    return {
      writeFile: (data, encoding) => handle.writeFile(data, encoding),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  copyFile: (source, destination) => nodeFs.copyFile(source, destination),
  unlink: (path) => nodeFs.unlink(path),
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDocument(document: StoreDocument): StoreDocument {
  return cloneValue(document);
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID();
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "EEXIST" || code === "EPERM" || code === "ENOTEMPTY";
}

function storageError(detail = "The local data store could not be accessed."): AppErrorException {
  return new AppErrorException(createAppError("STORAGE", detail));
}

function importError(): AppErrorException {
  return new AppErrorException(
    createAppError("IMPORT", "The imported store document is not valid."),
  );
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw createValidationError("The store record is not valid.");
  }
  return result.data;
}

function findWorkspace(document: StoreDocument, id: string): Workspace {
  const workspace = document.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) {
    throw createValidationError("The workspace could not be found.");
  }
  return workspace;
}

function parsePromptDraft(value: unknown): PromptDraft {
  return parseWithSchema(promptDraftSchema, value);
}

function parseConnectionDraft(
  value: unknown,
): Omit<Connection, "id" | "createdAt" | "updatedAt" | "hasCredential"> {
  if (typeof value !== "object" || value === null) {
    throw createValidationError("The connection is not valid.");
  }
  const result = connectionSchema.safeParse({
    ...(value as Record<string, unknown>),
    id: "draft",
    hasCredential: false,
    createdAt: DRAFT_TIMESTAMP,
    updatedAt: DRAFT_TIMESTAMP,
  });
  if (!result.success) {
    throw createValidationError("The connection is not valid.");
  }
  return {
    name: result.data.name,
    provider: result.data.provider,
    baseUrl: result.data.baseUrl,
    model: result.data.model,
  };
}

function parseRequestInput(value: RequestSaveInput, id: string, createdAt: string): RequestRecord {
  return parseWithSchema(requestRecordSchema, {
    ...value,
    id,
    createdAt,
  });
}

function countDocument(document: StoreDocument): ImportCounts {
  return {
    workspaces: document.workspaces.length,
    prompts: document.prompts.length,
    connections: document.connections.length,
    requests: document.requests.length,
  };
}

export class ForgeboardStore {
  private readonly dataDirectory: string;
  private readonly storePath: string;
  private readonly backupDirectory: string;
  private readonly storeFileSystem: StoreFileSystem;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly migrations: Readonly<Record<number, StoreMigration>>;
  private readonly credentialVault: CredentialVaultContract;
  private document: StoreDocument;
  private recoveryNotice: string | undefined;
  private credentialsAvailable = false;

  constructor(
    dataDirectory: string,
    credentials: CredentialVaultContract,
    options: ForgeboardStoreOptions = {},
  ) {
    this.dataDirectory = dataDirectory;
    this.storePath = join(dataDirectory, STORE_FILE_NAME);
    this.backupDirectory = join(dataDirectory, BACKUP_DIRECTORY_NAME);
    this.credentialVault = credentials;
    this.storeFileSystem = options.fileSystem
      ? { ...defaultFileSystem, ...options.fileSystem, open: options.fileSystem.open }
      : defaultFileSystem;
    this.now = options.now ?? nowIso;
    this.idFactory = options.idFactory ?? newId;
    this.migrations = options.migrations ?? {};
    this.document = createDefaultDocument();
  }

  get dataPath(): string {
    return this.storePath;
  }

  get backupPath(): string {
    return this.backupDirectory;
  }

  /** Main-process-only accessors used for dependency wiring and focused tests. */
  get fileSystem(): StoreFileSystem {
    return this.storeFileSystem;
  }

  get credentials(): CredentialVaultContract {
    return this.credentialVault;
  }

  get fileSystemForTesting(): StoreFileSystem {
    return this.storeFileSystem;
  }

  get credentialsForTesting(): CredentialVaultContract {
    return this.credentialVault;
  }

  getState(): AppState {
    const document = cloneDocument(this.document);
    const activeWorkspace =
      document.workspaces.find((workspace) => workspace.id === document.activeWorkspaceId) ??
      document.workspaces[0];

    if (!activeWorkspace) {
      throw storageError("The local data store has no active workspace.");
    }

    return {
      document,
      activeWorkspace: { ...activeWorkspace },
      ...(this.recoveryNotice ? { recoveryNotice: this.recoveryNotice } : {}),
      credentialsAvailable: this.credentialsAvailable,
    };
  }

  getDocument(): StoreDocument {
    return cloneDocument(this.document);
  }

  async load(): Promise<LoadResult> {
    await this.ensureDirectories();

    let mainContents: string | undefined;
    try {
      mainContents = await this.storeFileSystem.readFile(this.storePath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw storageError();
      }
    }

    if (mainContents !== undefined) {
      const parsed = this.tryParseDocument(mainContents);
      if (parsed) {
        this.document = await this.refreshCredentialFlags(parsed);
        this.recoveryNotice = undefined;
        this.credentialsAvailable = this.readCredentialsAvailability();
        try {
          const normalizedContents = serializeSnapshot(this.document);
          if (normalizedContents !== mainContents) {
            await this.persistCandidate(this.document);
          }
        } catch {
          // A readable document remains usable even if normalization cannot be
          // written; the next mutation can retry the atomic write.
        }
        return { document: cloneDocument(this.document) };
      }

      const recovered = await this.findNewestValidBackup();
      if (recovered) {
        this.document = await this.refreshCredentialFlags(recovered);
        this.recoveryNotice =
          "The main data file was invalid, so Forgeboard recovered the newest valid backup.";
        this.credentialsAvailable = this.readCredentialsAvailability();

        try {
          await this.writeMainWithoutBackup(serializeSnapshot(this.document));
        } catch {
          // Keep the recovered in-memory state even if restoring the main file
          // fails. The next load can try the same backup again.
        }

        return {
          document: cloneDocument(this.document),
          recoveryNotice: this.recoveryNotice,
        };
      }

      this.document = createDefaultDocument();
      this.recoveryNotice =
        "The local data file was invalid and no valid backup was available; a fresh workspace was created.";
      this.credentialsAvailable = this.readCredentialsAvailability();
      await this.writeMainWithoutBackup(serializeSnapshot(this.document));
      return {
        document: cloneDocument(this.document),
        recoveryNotice: this.recoveryNotice,
      };
    }

    this.document = createDefaultDocument();
    this.recoveryNotice = undefined;
    this.credentialsAvailable = this.readCredentialsAvailability();
    await this.writeMainWithoutBackup(serializeSnapshot(this.document));
    return { document: cloneDocument(this.document) };
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const timestamp = this.now();
    const workspace = parseWithSchema(workspaceSchema, {
      id: this.idFactory(),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.commit((draft) => {
      draft.workspaces.push(workspace);
      draft.activeWorkspaceId = workspace.id;
      const active = findWorkspace(draft, draft.activeWorkspaceId);
      active.updatedAt = workspace.updatedAt;
    });
    return cloneValue(workspace);
  }

  async renameWorkspace(id: string, name: string): Promise<Workspace> {
    let result: Workspace | undefined;
    await this.commit((draft) => {
      const workspace = findWorkspace(draft, id);
      const updatedAt = this.now();
      const validated = parseWithSchema(workspaceSchema, {
        ...workspace,
        name,
        updatedAt,
      });
      draft.workspaces[draft.workspaces.findIndex((item) => item.id === id)] = validated;
      result = validated;
    });
    return cloneValue(result!);
  }

  async updateWorkspace(id: string, name: string): Promise<Workspace> {
    return this.renameWorkspace(id, name);
  }

  async setActiveWorkspace(id: string): Promise<Workspace> {
    let result: Workspace | undefined;
    await this.commit((draft) => {
      result = findWorkspace(draft, id);
      draft.activeWorkspaceId = id;
    });
    return cloneValue(result!);
  }

  async deleteWorkspace(id: string): Promise<Workspace> {
    let result: Workspace | undefined;
    await this.commit((draft) => {
      findWorkspace(draft, id);
      if (draft.workspaces.length === 1) {
        throw createValidationError("At least one workspace must remain.");
      }
      draft.workspaces = draft.workspaces.filter((workspace) => workspace.id !== id);
      draft.prompts = draft.prompts.filter((prompt) => prompt.workspaceId !== id);
      draft.requests = draft.requests.filter((request) => request.workspaceId !== id);
      if (draft.activeWorkspaceId === id) {
        draft.activeWorkspaceId = draft.workspaces[0].id;
      }
      result = draft.workspaces.find((workspace) => workspace.id === draft.activeWorkspaceId);
    });
    return cloneValue(result!);
  }

  async savePrompt(input: PromptSaveInput): Promise<Prompt> {
    let result: Prompt | undefined;
    await this.commit((draft) => {
      const workspaceId = input.workspaceId ?? draft.activeWorkspaceId;
      const workspace = findWorkspace(draft, workspaceId);
      const promptDraft = parsePromptDraft(input);
      const existing = input.id
        ? draft.prompts.find((prompt) => prompt.id === input.id)
        : undefined;
      const now = this.now();
      const validated = parseWithSchema(promptSchema, {
        id: input.id ?? this.idFactory(),
        workspaceId,
        ...promptDraft,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      draft.prompts = draft.prompts.filter((item) => item.id !== validated.id);
      draft.prompts.push(validated);
      workspace.updatedAt = now;
      result = validated;
    });
    return cloneValue(result!);
  }

  async deletePrompt(id: string): Promise<void> {
    await this.commit((draft) => {
      const before = draft.prompts.length;
      draft.prompts = draft.prompts.filter((prompt) => prompt.id !== id);
      if (draft.prompts.length === before) {
        throw createValidationError("The prompt could not be found.");
      }
    });
  }

  async getPrompts(): Promise<Prompt[]> {
    return cloneValue(this.document.prompts);
  }

  async getWorkspaces(): Promise<Workspace[]> {
    return cloneValue(this.document.workspaces);
  }

  async getConnections(): Promise<Connection[]> {
    return cloneValue(this.document.connections);
  }

  async saveConnection(
    input: ConnectionSaveInput,
    transientCredential?: string,
  ): Promise<Connection> {
    const normalizedInput: ConnectionSaveInput =
      transientCredential === undefined
        ? input
        : { ...input, credential: transientCredential };
    const id = normalizedInput.id ?? this.idFactory();
    const draftFields = parseConnectionDraft(normalizedInput);
    const existing = this.document.connections.find((connection) => connection.id === id);
    const previousCredential = await this.credentialVault.get(id);
    const credentialProvided = typeof normalizedInput.credential === "string";
    try {
      if (credentialProvided) {
        if (normalizedInput.credential!.length === 0) {
          await this.credentialVault.delete(id);
        } else {
          await this.credentialVault.set(id, normalizedInput.credential!);
        }
      }
      const hasCredential = await this.credentialVault.has(id);
      const now = this.now();
      const connection = parseWithSchema(connectionSchema, {
        id,
        ...draftFields,
        hasCredential,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      await this.commit((draft) => {
        draft.connections = draft.connections.filter((item) => item.id !== id);
        draft.connections.push(connection);
      });
      return cloneValue(connection);
    } catch (error) {
      if (credentialProvided) {
        if (previousCredential === undefined) {
          await this.credentialVault.delete(id).catch(() => undefined);
        } else {
          await this.credentialVault.set(id, previousCredential).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async createConnection(input: ConnectionSaveInput): Promise<Connection> {
    return this.saveConnection(input);
  }

  async deleteConnection(id: string): Promise<void> {
    const existing = this.document.connections.find((connection) => connection.id === id);
    if (!existing) {
      throw createValidationError("The connection could not be found.");
    }
    const previousCredential = await this.credentialVault.get(id);
    await this.credentialVault.delete(id);

    try {
      await this.commit((draft) => {
        draft.connections = draft.connections.filter((connection) => connection.id !== id);
        draft.requests = draft.requests.map((request) =>
          request.connectionId === id ? { ...request, retained: true } : request,
        );
        if (draft.settings.defaultConnectionId === id) {
          delete draft.settings.defaultConnectionId;
        }
      });
    } catch (error) {
      if (previousCredential !== undefined) {
        await this.credentialVault.set(id, previousCredential).catch(() => undefined);
      }
      throw error;
    }
  }

  async addRequest(input: RequestSaveInput): Promise<RequestRecord> {
    return this.saveRequest(input);
  }

  async createRequest(input: RequestSaveInput): Promise<RequestRecord> {
    return this.saveRequest(input);
  }

  async deleteRequest(id: string): Promise<void> {
    await this.commit((draft) => {
      const before = draft.requests.length;
      draft.requests = draft.requests.filter((request) => request.id !== id);
      if (draft.requests.length === before) {
        throw createValidationError("The request record could not be found.");
      }
    });
  }

  async getRequests(): Promise<RequestRecord[]> {
    return cloneValue(this.document.requests);
  }

  async saveRequest(input: RequestSaveInput | RequestRecord): Promise<RequestRecord> {
    let result: RequestRecord | undefined;
    await this.commit((draft) => {
      const workspace = findWorkspace(draft, input.workspaceId);
      const id = input.id ?? this.idFactory();
      const timestamp = this.now();
      const createdAt = input.createdAt ?? timestamp;
      const request = parseRequestInput(input, id, createdAt);
      draft.requests = draft.requests.filter((item) => item.id !== request.id);
      draft.requests.push(request);
      workspace.updatedAt = timestamp;
      result = request;
    });
    return cloneValue(result!);
  }

  async getSettings(): Promise<Settings> {
    return { ...this.document.settings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    let result: Settings | undefined;
    await this.commit((draft) => {
      const settings = parseWithSchema(settingsSchema, {
        ...draft.settings,
        ...patch,
      });
      if (
        settings.defaultConnectionId &&
        !draft.connections.some((connection) => connection.id === settings.defaultConnectionId)
      ) {
        throw createValidationError("The default connection could not be found.");
      }
      draft.settings = settings;
      result = settings;
    });
    return { ...result! };
  }

  exportSnapshot(): string {
    return serializeSnapshot(this.document);
  }

  exportData(): ExportData {
    return {
      filename: "forgeboard-export.json",
      contents: this.exportSnapshot(),
    };
  }

  async importSnapshot(value: string | StoreDocument): Promise<ImportReport> {
    let imported: StoreDocument;
    try {
      imported = migrateStoreDocument(value, this.migrations);
    } catch {
      throw importError();
    }

    const sanitized = await this.refreshCredentialFlags(imported);
    const warnings: string[] = [];
    const importedCredentialIds = imported.connections
      .filter((connection) => connection.hasCredential)
      .map((connection) => connection.id);
    if (importedCredentialIds.length > 0) {
      warnings.push("Credential values are not included in Forgeboard imports.");
    }
    if (
      importedCredentialIds.some(
        (id) => !sanitized.connections.find((connection) => connection.id === id)?.hasCredential,
      )
    ) {
      warnings.push("Some connection credentials must be entered again after import.");
    }

    await this.persistCandidate(sanitized);
    this.recoveryNotice = undefined;
    return { counts: countDocument(sanitized), warnings };
  }

  async importData(value: string | StoreDocument): Promise<ImportReport> {
    return this.importSnapshot(value);
  }

  private async commit(
    mutate: (draft: StoreDocument) => void | Promise<void>,
  ): Promise<void> {
    const draft = cloneDocument(this.document);
    await mutate(draft);
    await this.persistCandidate(draft);
  }

  private async persistCandidate(candidate: StoreDocument): Promise<void> {
    const validated = parseStoreDocument(candidate);
    const contents = serializeSnapshot(validated);
    const currentContents = await this.readMainFileIfPresent();
    if (currentContents !== undefined && this.tryParseDocument(currentContents)) {
      await this.rotateBackups(currentContents);
    }
    await this.writeMainWithoutBackup(contents);
    this.document = cloneDocument(validated);
  }

  private async ensureDirectories(): Promise<void> {
    try {
      await this.storeFileSystem.mkdir(this.dataDirectory, { recursive: true });
      await this.storeFileSystem.mkdir(this.backupDirectory, { recursive: true });
    } catch {
      throw storageError();
    }
  }

  private async readMainFileIfPresent(): Promise<string | undefined> {
    try {
      return await this.storeFileSystem.readFile(this.storePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw storageError();
    }
  }

  private tryParseDocument(contents: string): StoreDocument | undefined {
    try {
      return migrateStoreDocument(contents, this.migrations);
    } catch {
      return undefined;
    }
  }

  private async findNewestValidBackup(): Promise<StoreDocument | undefined> {
    for (let slot = 1; slot <= BACKUP_COUNT; slot += 1) {
      const path = this.backupFilePath(slot);
      try {
        const contents = await this.storeFileSystem.readFile(path, "utf8");
        const parsed = this.tryParseDocument(contents);
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw storageError();
        }
      }
    }
    return undefined;
  }

  private backupFilePath(slot: number): string {
    return join(this.backupDirectory, `forgeboard-${String(slot).padStart(3, "0")}.json`);
  }

  private async rotateBackups(currentContents: string): Promise<void> {
    const validBackups: string[] = [];
    for (let slot = 1; slot <= BACKUP_COUNT; slot += 1) {
      const path = this.backupFilePath(slot);
      try {
        const contents = await this.storeFileSystem.readFile(path, "utf8");
        if (this.tryParseDocument(contents)) {
          validBackups.push(contents);
        }
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw storageError();
        }
      }
    }

    const backups = [currentContents, ...validBackups].slice(0, BACKUP_COUNT);
    for (let index = 0; index < backups.length; index += 1) {
      await this.writeFileAtomically(this.backupFilePath(index + 1), backups[index]);
    }
    for (let slot = backups.length + 1; slot <= BACKUP_COUNT; slot += 1) {
      await this.storeFileSystem.unlink(this.backupFilePath(slot)).catch(() => undefined);
    }
  }

  private async writeMainWithoutBackup(contents: string): Promise<void> {
    await this.writeFileAtomically(this.storePath, contents);
  }

  private async writeFileAtomically(destinationPath: string, contents: string): Promise<void> {
    const directory = dirname(destinationPath);
    const temporaryPath = `${destinationPath}${TEMPORARY_FILE_SUFFIX}`;
    let handle: StoreFileHandle | undefined;

    try {
      await this.storeFileSystem.mkdir(directory, { recursive: true });
      if (this.storeFileSystem.open) {
        handle = await this.storeFileSystem.open(temporaryPath, "w", 0o600);
        await handle.writeFile(contents, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
      } else {
        await this.storeFileSystem.writeFile(temporaryPath, contents, "utf8");
      }
      await this.replaceFile(temporaryPath, destinationPath);
    } catch {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await this.storeFileSystem.unlink(temporaryPath).catch(() => undefined);
      throw storageError();
    }
  }

  private async replaceFile(temporaryPath: string, destinationPath: string): Promise<void> {
    try {
      await this.storeFileSystem.rename(temporaryPath, destinationPath);
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const oldPath = `${destinationPath}.old-${this.idFactory()}`;
    let movedOldFile = false;
    try {
      await this.storeFileSystem.rename(destinationPath, oldPath);
      movedOldFile = true;
      await this.storeFileSystem.rename(temporaryPath, destinationPath);
      await this.storeFileSystem.unlink(oldPath).catch(() => undefined);
    } catch (error) {
      if (movedOldFile) {
        await this.storeFileSystem.rename(oldPath, destinationPath).catch(() => undefined);
      }
      throw error;
    }
  }

  private async refreshCredentialFlags(document: StoreDocument): Promise<StoreDocument> {
    const refreshed = cloneDocument(document);
    for (const connection of refreshed.connections) {
      try {
        connection.hasCredential = await this.credentialVault.has(connection.id);
      } catch {
        connection.hasCredential = false;
      }
    }
    return refreshed;
  }

  private readCredentialsAvailability(): boolean {
    try {
      return this.credentialVault.isEncryptionAvailable?.() ?? false;
    } catch {
      return false;
    }
  }
}

export { STORE_FILE_NAME, BACKUP_DIRECTORY_NAME };
