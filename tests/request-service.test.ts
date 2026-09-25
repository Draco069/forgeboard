import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialVault } from "../src/main/credentials";
import { ProviderRegistry } from "../src/main/providers";
import { RequestService } from "../src/main/request-service";
import { ForgeboardStore } from "../src/main/store";
import type { RunEvent } from "../src/shared/types";

interface TestServer {
  server: ReturnType<typeof createServer>;
  url: string;
  requestBodies: string[];
}

interface Harness {
  directory: string;
  store: ForgeboardStore;
  credentials: MemoryCredentialVault;
  workspaceId: string;
}

class MemoryCredentialVault implements CredentialVault {
  private readonly values = new Map<string, string>();

  isEncryptionAvailable(): boolean {
    return true;
  }

  has(id: string): Promise<boolean> {
    return Promise.resolve(this.values.has(id));
  }

  get(id: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(id));
  }

  set(id: string, value: string): Promise<boolean> {
    this.values.set(id, value);
    return Promise.resolve(true);
  }

  delete(id: string): Promise<void> {
    this.values.delete(id);
    return Promise.resolve();
  }
}

const servers: TestServer[] = [];
const temporaryDirectories: string[] = [];

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<TestServer> {
  const requestBodies: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(Buffer.concat(chunks).toString("utf8"));
    });
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) {
        response.statusCode = 500;
      }
      if (!response.writableEnded) {
        response.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The local test server did not expose a TCP port.");
  }

  const result: TestServer = {
    server,
    url: `http://127.0.0.1:${address.port}`,
    requestBodies,
  };
  servers.push(result);
  return result;
}

async function closeServer(testServer: TestServer): Promise<void> {
  testServer.server.closeAllConnections();
  if (!testServer.server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    testServer.server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function createHarness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "forgeboard-requests-"));
  temporaryDirectories.push(directory);
  const credentials = new MemoryCredentialVault();
  const store = new ForgeboardStore(directory, credentials);
  await store.load();
  return {
    directory,
    store,
    credentials,
    workspaceId: store.getState().activeWorkspace.id,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("RequestService", () => {
  it("streams, persists, and emits a completed request lifecycle", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.write(
        'data: {"model":"stream-model","choices":[{"delta":{"content":"hello"}}]}\n\n',
      );
      response.end('data: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n');
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: `${testServer.url}/v1`,
      model: "stream-model",
      credential: "request-api-key",
    });
    const prompt = await harness.store.savePrompt({
      workspaceId: harness.workspaceId,
      title: "Greeting",
      description: "",
      body: "Say hello",
      tags: [],
      favorite: false,
    });
    const events: RunEvent[] = [];
    const service = new RequestService(harness.store, new ProviderRegistry());

    const record = await service.run(
      {
        workspaceId: harness.workspaceId,
        promptId: prompt.id,
        connectionId: connection.id,
        renderedPrompt: "hello",
        stream: true,
      },
      (event) => events.push(event),
    );

    expect(record).toMatchObject({
      workspaceId: harness.workspaceId,
      promptId: prompt.id,
      connectionId: connection.id,
      provider: "openai-compatible",
      model: "stream-model",
      renderedPrompt: "hello",
      response: "hello world",
      status: "success",
    });
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "delta",
      "completed",
    ]);
    expect(events.every((event) => event.requestId === record.id)).toBe(true);
    expect(events[1]).toMatchObject({ text: "hello" });
    expect(events[2]).toMatchObject({ text: " world" });
    expect(events[3]).toMatchObject({ record });
    expect(harness.store.getState().document.requests).toEqual([record]);
    expect(JSON.parse(testServer.requestBodies[0] ?? "{}")).toMatchObject({
      model: "stream-model",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    expect(service.cancel(record.id)).toBe(false);
  });

  it("persists a safe error record and emits a typed error before rejecting", async () => {
    const credential = "lifecycle-secret-value";
    const testServer = await startServer((_request, response) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: { message: `leaked ${credential}` } }));
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: testServer.url,
      model: "model",
      credential,
    });
    const events: RunEvent[] = [];
    const service = new RequestService(harness.store);

    await expect(
      service.run(
        {
          workspaceId: harness.workspaceId,
          connectionId: connection.id,
          renderedPrompt: `The secret is ${credential}`,
        },
        (event) => events.push(event),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER", retryable: true });

    expect(events.map((event) => event.type)).toEqual(["started", "error"]);
    const errorEvent = events[1];
    expect(errorEvent).toMatchObject({
      error: { code: "PROVIDER", retryable: true },
      record: { status: "error", response: "" },
    });
    const persisted = harness.store.getState().document.requests;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      status: "error",
      response: "",
      errorMessage: "The provider could not complete the request.",
    });
    const exposedData = JSON.stringify({ events, persisted, snapshot: harness.store.exportSnapshot() });
    expect(exposedData).not.toContain(credential);
    expect(exposedData).not.toContain("Authorization");
  });

  it("cancels an active request and records an empty cancelled response", async () => {
    let requestStarted!: () => void;
    const serverReceivedRequest = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const testServer = await startServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      response.flushHeaders();
      requestStarted();
      await new Promise<void>((resolve) => request.once("close", resolve));
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: testServer.url,
      model: "model",
    });
    const events: RunEvent[] = [];
    let resolveStarted!: (requestId: string) => void;
    const started = new Promise<string>((resolve) => {
      resolveStarted = resolve;
    });
    const service = new RequestService(harness.store);
    const pending = service.run(
      {
        workspaceId: harness.workspaceId,
        connectionId: connection.id,
        renderedPrompt: "hello",
      },
      (event) => {
        events.push(event);
        if (event.type === "started") {
          resolveStarted(event.requestId);
        }
      },
    );
    const requestId = await started;
    await serverReceivedRequest;

    expect(service.cancel(requestId)).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });

    expect(events.map((event) => event.type)).toEqual(["started", "cancelled"]);
    expect(events[1]).toMatchObject({
      record: { id: requestId, status: "cancelled", response: "" },
    });
    expect(harness.store.getState().document.requests[0]).toMatchObject({
      id: requestId,
      status: "cancelled",
      response: "",
    });
    expect(service.cancel(requestId)).toBe(false);
  });

  it("honors cancellation while a completed response is being persisted", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          model: "model",
          choices: [{ message: { content: "finished" } }],
        }),
      );
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: testServer.url,
      model: "model",
    });
    const originalSaveRequest = harness.store.saveRequest.bind(harness.store);
    let markPersistenceStarted!: () => void;
    const persistenceStarted = new Promise<void>((resolve) => {
      markPersistenceStarted = resolve;
    });
    let releasePersistence!: () => void;
    const persistenceReleased = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    vi.spyOn(harness.store, "saveRequest").mockImplementationOnce(async (record) => {
      markPersistenceStarted();
      await persistenceReleased;
      return originalSaveRequest(record);
    });
    const events: RunEvent[] = [];
    const service = new RequestService(harness.store);
    const pending = service.run(
      {
        workspaceId: harness.workspaceId,
        connectionId: connection.id,
        renderedPrompt: "hello",
      },
      (event) => events.push(event),
    );

    await persistenceStarted;
    const requestId = events[0]?.requestId;
    expect(requestId).toBeDefined();
    expect(service.cancel(requestId!)).toBe(true);
    releasePersistence();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(events.at(-1)).toMatchObject({
      type: "cancelled",
      record: { status: "cancelled", response: "finished" },
    });
    expect(harness.store.getState().document.requests).toEqual([
      expect.objectContaining({ id: requestId, status: "cancelled", response: "finished" }),
    ]);
  });

  it("records timeouts as retryable errors rather than cancellations", async () => {
    const testServer = await startServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      response.flushHeaders();
      await new Promise<void>((resolve) => request.once("close", resolve));
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: testServer.url,
      model: "model",
    });
    const events: RunEvent[] = [];
    const service = new RequestService(harness.store);

    await expect(
      service.run(
        {
          workspaceId: harness.workspaceId,
          connectionId: connection.id,
          renderedPrompt: "hello",
          timeoutMs: 20,
        },
        (event) => events.push(event),
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { code: "TIMEOUT", retryable: true },
      record: { status: "error" },
    });
    expect(harness.store.getState().document.requests[0]).toMatchObject({
      status: "error",
      errorMessage: "The request timed out.",
    });
  });

  it("can retry the same input after a provider failure", async () => {
    let attempts = 0;
    const testServer = await startServer((_request, response) => {
      attempts += 1;
      response.setHeader("content-type", "application/json");
      if (attempts === 1) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: { message: "retry me" } }));
        return;
      }
      response.end(
        JSON.stringify({
          model: "model",
          choices: [{ message: { content: "recovered" } }],
        }),
      );
    });
    const harness = await createHarness();
    const connection = await harness.store.saveConnection({
      name: "Remote",
      provider: "openai-compatible",
      baseUrl: testServer.url,
      model: "model",
    });
    const service = new RequestService(harness.store);
    const input = {
      workspaceId: harness.workspaceId,
      connectionId: connection.id,
      renderedPrompt: "hello",
    };

    await expect(service.run(input, () => undefined)).rejects.toMatchObject({
      code: "PROVIDER",
    });
    const retried = await service.run(input, () => undefined);

    expect(retried).toMatchObject({ response: "recovered", status: "success" });
    expect(harness.store.getState().document.requests).toHaveLength(2);
    expect(harness.store.getState().document.requests.map((request) => request.status)).toEqual([
      "error",
      "success",
    ]);
    expect(attempts).toBe(2);
  });

  it("rejects unknown connections without starting a request", async () => {
    const harness = await createHarness();
    const events: RunEvent[] = [];
    const service = new RequestService(harness.store);

    await expect(
      service.run(
        {
          workspaceId: harness.workspaceId,
          connectionId: "missing-connection",
          renderedPrompt: "hello",
        },
        (event) => events.push(event),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(events).toEqual([]);
    expect(harness.store.getState().document.requests).toEqual([]);
  });
});
