import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import * as electron from "electron";
import {
  AppErrorException,
  createAppError,
} from "../shared/errors";

const CREDENTIAL_FILE_NAME = "credentials.json";
const CREDENTIAL_SCHEMA_VERSION = 1 as const;

/** The small crypto surface needed by the vault, injectable for tests. */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CredentialVault {
  has(id: string): Promise<boolean>;
  get(id: string): Promise<string | undefined>;
  set(id: string, value: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  isEncryptionAvailable?(): boolean;
}

export type CredentialVaultContract = CredentialVault;

interface CredentialFile {
  schemaVersion: typeof CREDENTIAL_SCHEMA_VERSION;
  entries: Record<string, string>;
}

interface ElectronModuleWithSafeStorage {
  safeStorage?: SecretCrypto;
  default?: {
    safeStorage?: SecretCrypto;
  };
}

const unavailableCrypto: SecretCrypto = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("Secure credential encryption is unavailable.");
  },
  decryptString: () => {
    throw new Error("Secure credential decryption is unavailable.");
  },
};

function getDefaultCrypto(): SecretCrypto {
  const electronModule = electron as unknown as ElectronModuleWithSafeStorage;
  return electronModule.safeStorage ?? electronModule.default?.safeStorage ?? unavailableCrypto;
}

function storageError(): AppErrorException {
  return new AppErrorException(
    createAppError("STORAGE", "Secure credential storage could not be accessed."),
  );
}

function validationError(detail: string): AppErrorException {
  return new AppErrorException(createAppError("VALIDATION", detail));
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function assertCredentialPart(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${name} must not be blank.`);
  }
}

function parseCredentialFile(contents: string): CredentialFile {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw storageError();
  }

  if (typeof value !== "object" || value === null) {
    throw storageError();
  }

  const candidate = value as {
    schemaVersion?: unknown;
    entries?: unknown;
  };
  const entries = candidate.entries;

  if (
    candidate.schemaVersion !== CREDENTIAL_SCHEMA_VERSION ||
    typeof entries !== "object" ||
    entries === null ||
    Array.isArray(entries)
  ) {
    throw storageError();
  }

  const parsedEntries: Record<string, string> = {};
  for (const [id, encoded] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof encoded !== "string" || encoded.length === 0) {
      throw storageError();
    }
    parsedEntries[id] = encoded;
  }

  return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, entries: parsedEntries };
}

function serializeCredentialFile(entries: ReadonlyMap<string, string>): string {
  const value: CredentialFile = {
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    entries: Object.fromEntries(entries),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function replaceFile(tempPath: string, destinationPath: string): Promise<void> {
  try {
    await rename(tempPath, destinationPath);
    return;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") {
      throw error;
    }
  }

  // Windows can reject replacing an existing file with rename. Keep the old
  // file recoverable until the fully-written temporary file has been moved.
  const oldPath = `${destinationPath}.old-${randomUUID()}`;
  let movedOldFile = false;
  try {
    await rename(destinationPath, oldPath);
    movedOldFile = true;
    await rename(tempPath, destinationPath);
    await unlink(oldPath).catch(() => undefined);
  } catch (error) {
    if (movedOldFile) {
      await rename(oldPath, destinationPath).catch(() => undefined);
    }
    throw error;
  }
}

export class SafeStorageCredentialVault implements CredentialVault {
  private readonly filePath: string;
  private readonly crypto: SecretCrypto;
  private readonly encryptedValues = new Map<string, string>();
  private readonly values = new Map<string, string>();
  private loaded = false;
  private loadPromise?: Promise<void>;

  constructor(filePathOrDirectory: string, crypto: SecretCrypto = getDefaultCrypto()) {
    this.filePath =
      extname(filePathOrDirectory).toLowerCase() === ".json"
        ? filePathOrDirectory
        : join(filePathOrDirectory, CREDENTIAL_FILE_NAME);
    this.crypto = crypto;
  }

  /** Returns the path for diagnostics inside the main process only. */
  getFilePath(): string {
    return this.filePath;
  }

  isEncryptionAvailable(): boolean {
    try {
      return this.crypto.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  has(id: string): Promise<boolean> {
    return this.withLoaded(async () => {
      this.decryptPersistedValuesIfNeeded();
      return this.values.has(id);
    });
  }

  async get(id: string): Promise<string | undefined> {
    assertCredentialPart(id, "Credential id");
    return this.withLoaded(async () => {
      this.decryptPersistedValuesIfNeeded();
      return this.values.get(id);
    });
  }

  async set(id: string, value: string): Promise<boolean> {
    assertCredentialPart(id, "Credential id");
    if (typeof value !== "string") {
      throw validationError("Credential value must be text.");
    }

    await this.load();
    this.decryptPersistedValuesIfNeeded();

    if (!this.isEncryptionAvailable()) {
      this.values.set(id, value);
      return false;
    }

    let encrypted: string;
    try {
      encrypted = Buffer.from(this.crypto.encryptString(value)).toString("base64");
    } catch {
      throw storageError();
    }

    const nextEncryptedValues = new Map(this.encryptedValues);
    nextEncryptedValues.set(id, encrypted);
    await this.persist(nextEncryptedValues);

    this.encryptedValues.clear();
    for (const [key, encoded] of nextEncryptedValues) {
      this.encryptedValues.set(key, encoded);
    }
    this.values.set(id, value);
    return true;
  }

  async delete(id: string): Promise<void> {
    assertCredentialPart(id, "Credential id");
    await this.load();

    const previousValue = this.values.get(id);
    const nextEncryptedValues = new Map(this.encryptedValues);
    const hadPersistedValue = nextEncryptedValues.delete(id);
    this.values.delete(id);

    if (hadPersistedValue) {
      try {
        await this.persist(nextEncryptedValues);
      } catch (error) {
        if (previousValue !== undefined) {
          this.values.set(id, previousValue);
        }
        throw error;
      }
    }

    this.encryptedValues.clear();
    for (const [key, encoded] of nextEncryptedValues) {
      this.encryptedValues.set(key, encoded);
    }
  }

  /** Eagerly loads and validates the encrypted map. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadFromDisk();
    try {
      await this.loadPromise;
      this.loaded = true;
    } finally {
      this.loadPromise = undefined;
    }
  }

  private async withLoaded<T>(callback: () => Promise<T> | T): Promise<T> {
    await this.load();
    return callback();
  }

  private decryptPersistedValuesIfNeeded(): void {
    if (!this.isEncryptionAvailable() || this.encryptedValues.size === 0) {
      return;
    }

    try {
      for (const [id, encoded] of this.encryptedValues) {
        if (this.values.has(id)) {
          continue;
        }
        const decrypted = this.crypto.decryptString(Buffer.from(encoded, "base64"));
        if (typeof decrypted !== "string") {
          throw new Error("Unexpected credential decryption result.");
        }
        this.values.set(id, decrypted);
      }
    } catch {
      this.values.clear();
      throw storageError();
    }
  }

  private async loadFromDisk(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw storageError();
    }

    const file = parseCredentialFile(contents);
    this.encryptedValues.clear();
    this.values.clear();
    for (const [id, encoded] of Object.entries(file.entries)) {
      this.encryptedValues.set(id, encoded);
    }

    this.decryptPersistedValuesIfNeeded();
  }

  private async persist(entries: ReadonlyMap<string, string>): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      await mkdir(directory, { recursive: true });
      handle = await open(temporaryPath, "w", 0o600);
      await handle.writeFile(serializeCredentialFile(entries), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await replaceFile(temporaryPath, this.filePath);
    } catch {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw storageError();
    }
  }
}

export const CredentialVault = SafeStorageCredentialVault;

export { CREDENTIAL_FILE_NAME };
export type { CredentialFile };
