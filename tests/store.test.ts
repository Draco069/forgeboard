import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialVault, type SecretCrypto } from "../src/main/credentials";
import { createDefaultDocument } from "../src/main/defaults";
import { ForgeboardStore } from "../src/main/store";
import type { StoreDocument } from "../src/shared/types";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forgeboard-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function createCrypto(available = true): SecretCrypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("encrypted:")) {
        throw new Error("invalid encrypted value");
      }
      return text.slice("encrypted:".length);
    },
  };
}

async function createStore(directory: string): Promise<{
  store: ForgeboardStore;
  credentials: CredentialVault;
}> {
  const credentials = new CredentialVault(join(directory, "credentials.json"), createCrypto());
  const store = new ForgeboardStore(directory, credentials);
  await store.load();
  return { store, credentials };
}

describe("ForgeboardStore", () => {
  it("creates and loads a valid default workspace", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);

    const loaded = await store.load();

    expect(loaded.document.workspaces).toHaveLength(1);
    expect(loaded.document.workspaces[0].name).toBe("Personal workspace");
    expect(loaded.document.activeWorkspaceId).toBe(loaded.document.workspaces[0].id);
    expect(store.getState().activeWorkspace.id).toBe(loaded.document.activeWorkspaceId);
  });

  it("saves prompts and reloads them from disk", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);
    const workspace = store.getState().activeWorkspace;

    const saved = await store.savePrompt({
      workspaceId: workspace.id,
      title: "Review code",
      description: "Find issues",
      body: "Review {{language}}",
      tags: ["review"],
      favorite: true,
    });

    const reloaded = await new ForgeboardStore(
      directory,
      new CredentialVault(join(directory, "credentials.json"), createCrypto()),
    ).load();

    expect(reloaded.document.prompts).toEqual([saved]);
    expect(reloaded.document.prompts[0].createdAt).toBe(saved.createdAt);
  });

  it("recovers the newest valid backup when the main document is corrupt", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);
    const workspace = store.getState().activeWorkspace;

    await store.savePrompt({
      workspaceId: workspace.id,
      title: "First",
      description: "",
      body: "first",
      tags: [],
      favorite: false,
    });
    const second = await store.savePrompt({
      workspaceId: workspace.id,
      title: "Second",
      description: "",
      body: "second",
      tags: [],
      favorite: false,
    });

    await writeFile(join(directory, "forgeboard.json"), "{not-json", "utf8");
    const recovered = await new ForgeboardStore(
      directory,
      new CredentialVault(join(directory, "credentials.json"), createCrypto()),
    ).load();

    expect(recovered.recoveryNotice).toContain("recovered");
    expect(recovered.document.prompts.some((prompt) => prompt.title === "First")).toBe(true);
    expect(recovered.document.prompts.some((prompt) => prompt.id === second.id)).toBe(false);
  });

  it("does not replace the in-memory document when an atomic write fails", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);
    const workspace = store.getState().activeWorkspace;
    const original = store.getState().document;

    const failingStore = new ForgeboardStore(directory, store.credentials, {
      fileSystem: {
        ...store.fileSystem,
        writeFile: async () => {
          throw new Error("disk full");
        },
        open: async () => {
          throw new Error("disk full");
        },
      },
    });
    await failingStore.load();

    await expect(
      failingStore.savePrompt({
        workspaceId: workspace.id,
        title: "Not saved",
        description: "",
        body: "body",
        tags: [],
        favorite: false,
      }),
    ).rejects.toMatchObject({ code: "STORAGE" });

    expect(failingStore.getState().document).toEqual(original);
    expect(JSON.parse(await readFile(join(directory, "forgeboard.json"), "utf8"))).toEqual(
      original,
    );
  });

  it("exports a secret-free snapshot and validates imports before replacing state", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);
    const workspace = store.getState().activeWorkspace;
    await store.saveConnection({
      name: "Local",
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
      credential: "super-secret-value",
    });
    const prompt = await store.savePrompt({
      workspaceId: workspace.id,
      title: "Imported source",
      description: "",
      body: "body",
      tags: [],
      favorite: false,
    });

    const exported = store.exportSnapshot();
    expect(exported).not.toContain("super-secret-value");
    expect(exported).not.toContain("credential");

    const current = store.getState().document;
    const invalid = JSON.parse(exported) as StoreDocument;
    invalid.prompts[0].workspaceId = "missing-workspace";
    await expect(store.importSnapshot(JSON.stringify(invalid))).rejects.toMatchObject({
      code: "IMPORT",
    });
    expect(store.getState().document).toEqual(current);

    const replacement = JSON.parse(exported) as StoreDocument;
    replacement.prompts = [replacement.prompts[0]];
    const report = await store.importSnapshot(replacement);

    expect(report.counts.workspaces).toBe(1);
    expect(report.counts.prompts).toBe(1);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(store.getState().document.prompts[0].id).toBe(prompt.id);
  });

  it("applies an explicitly registered migration before loading", async () => {
    const directory = await createTemporaryDirectory();
    const credentials = new CredentialVault(
      join(directory, "credentials.json"),
      createCrypto(),
    );
    const legacy = { ...createDefaultDocument(), schemaVersion: 0 };
    await writeFile(join(directory, "forgeboard.json"), JSON.stringify(legacy), "utf8");

    const store = new ForgeboardStore(directory, credentials, {
      migrations: {
        0: (value) => ({ ...(value as Record<string, unknown>), schemaVersion: 1 }),
      },
    });
    const result = await store.load();

    expect(result.document.schemaVersion).toBe(1);
    expect(result.document.workspaces).toHaveLength(1);
  });

  it("marks session-only credentials unavailable after a restart", async () => {
    const directory = await createTemporaryDirectory();
    const credentialsPath = join(directory, "credentials.json");
    const firstCredentials = new CredentialVault(credentialsPath, createCrypto(false));
    const firstStore = new ForgeboardStore(directory, firstCredentials);
    expect(firstCredentials.isEncryptionAvailable()).toBe(false);
    await firstStore.load();
    const connection = await firstStore.saveConnection({
      name: "Session only",
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
      credential: "session-secret",
    });
    expect(connection.hasCredential).toBe(true);

    const restartedCredentials = new CredentialVault(
      credentialsPath,
      createCrypto(false),
    );
    const restartedStore = new ForgeboardStore(directory, restartedCredentials);
    const result = await restartedStore.load();
    expect(await restartedCredentials.has(connection.id)).toBe(false);
    expect(result.document.connections[0].hasCredential).toBe(false);
  });

  it("cleans workspace records and retains history when a connection is deleted", async () => {
    const directory = await createTemporaryDirectory();
    const { store } = await createStore(directory);
    const firstWorkspace = store.getState().activeWorkspace;
    const secondWorkspace = await store.createWorkspace("Team");
    const connection = await store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "model",
    });
    const prompt = await store.savePrompt({
      workspaceId: firstWorkspace.id,
      title: "Keep in workspace",
      description: "",
      body: "body",
      tags: [],
      favorite: false,
    });
    const request = await store.addRequest({
      workspaceId: secondWorkspace.id,
      promptId: prompt.id,
      connectionId: connection.id,
      provider: connection.provider,
      model: connection.model,
      renderedPrompt: "body",
      response: "historical response",
      status: "success",
    });

    await store.deleteConnection(connection.id);
    expect(store.getState().document.connections).toHaveLength(0);
    expect(store.getState().document.requests[0]).toMatchObject({
      id: request.id,
      response: "historical response",
      retained: true,
    });

    await store.deleteWorkspace(firstWorkspace.id);
    expect(store.getState().document.workspaces.map((item) => item.id)).toEqual([
      secondWorkspace.id,
    ]);
    expect(store.getState().document.prompts).toHaveLength(0);
    expect(store.getState().document.requests).toHaveLength(1);
  });
});
