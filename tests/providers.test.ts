import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
 MAX_PROVIDER_TIMEOUT_MS,
 OpenAICompatibleProvider,
 OllamaProvider,
 ProviderRegistry,
 type ProviderRequest,
} from "../src/main/providers";
import { MAX_PROMPT_LENGTH } from "../src/shared/validation";

interface TestServer {
  server: ReturnType<typeof createServer>;
  url: string;
  requests: RecordedRequest[];
}

interface RecordedRequest {
  method?: string;
  url?: string;
  authorization?: string;
  body: string;
}

const servers: TestServer[] = [];

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
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

  const result = {
    server,
    url: `http://127.0.0.1:${address.port}`,
    requests,
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

function baseRequest(
  baseUrl: string,
  overrides: Partial<ProviderRequest> = {},
): ProviderRequest {
  return {
    baseUrl,
    model: "test-model",
    prompt: "hello",
    stream: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("provider adapters", () => {
  it("normalizes an Ollama JSON chat response", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          model: "llama3.2",
          message: { content: "done" },
          done: true,
        }),
      );
    });
    const deltas: string[] = [];
    const adapter = new OllamaProvider();

    const result = await adapter.run(
      baseRequest(testServer.url),
      (chunk) => deltas.push(chunk),
    );

    expect(result).toMatchObject({ text: "done", model: "llama3.2" });
    expect(deltas).toEqual([]);
  });

  it("normalizes an OpenAI-compatible JSON response and sends bearer auth", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "remote-model-v2",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "complete" },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      );
    });
    const result = await new OpenAICompatibleProvider().run(
      baseRequest(testServer.url, {
        credential: "test-api-key",
        model: " requested-model ",
      }),
      () => undefined,
    );

    expect(result.text).toBe("complete");
    expect(result.model).toBe("remote-model-v2");
    expect(result.metadata).toMatchObject({
      responseId: "chatcmpl-test",
      finishReason: "stop",
    });
    const recorded = testServer.requests[0];
    expect(recorded?.method).toBe("POST");
    expect(recorded?.url).toBe("/chat/completions");
    expect(recorded?.authorization).toBe("Bearer test-api-key");
    expect(JSON.parse(recorded?.body ?? "{}")).toEqual({
      model: "requested-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
  });

  it("preserves a base URL path prefix while normalizing trailing slashes", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          model: "model",
          choices: [{ message: { content: "prefixed" } }],
        }),
      );
    });

    await new OpenAICompatibleProvider().run(
      baseRequest(`${testServer.url}/gateway/v1///`),
      () => undefined,
    );

    const recorded = testServer.requests[0];
    expect(recorded?.url).toBe("/gateway/v1/chat/completions");
  });

  it("normalizes OpenAI SSE chunks and emits every delta once", async () => {
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.write(
        'data: {"model":"stream-model","choices":[{"delta":{"role":"assistant"}}]}\n\n',
      );
      response.write(
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n' +
          "data: [DONE]\n\n",
      );
      response.end();
    });
    const deltas: string[] = [];

    const result = await new OpenAICompatibleProvider().run(
      baseRequest(testServer.url, { stream: true }),
      (chunk) => deltas.push(chunk),
    );

    expect(result.text).toBe("hello");
    expect(result.model).toBe("stream-model");
    expect(deltas).toEqual(["hel", "lo"]);
    const recorded = testServer.requests[0];
    expect(recorded?.url).toBe("/chat/completions");
    expect(JSON.parse(recorded?.body ?? "{}").stream).toBe(true);
  });

  it("normalizes Ollama NDJSON chunks split across network reads", async () => {
    const testServer = await startServer(async (_request, response) => {
      response.setHeader("content-type", "application/x-ndjson");
      response.write('{"model":"llama3.2","message":{"content":"one"}}\n');
      await delay(5);
      response.write('{"message":{"content":" two"');
      await delay(5);
      response.write('},"done":true}\n');
      response.end();
    });
    const deltas: string[] = [];

    const result = await new OllamaProvider().run(
      baseRequest(testServer.url, { stream: true }),
      (chunk) => deltas.push(chunk),
    );

    expect(result.text).toBe("one two");
    expect(result.model).toBe("llama3.2");
    expect(result.metadata).toMatchObject({ done: true });
    expect(deltas).toEqual(["one", " two"]);
    const recorded = testServer.requests[0];
    expect(recorded?.url).toBe("/api/chat");
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "AUTHENTICATION"],
    [429, "RATE_LIMIT"],
    [500, "PROVIDER"],
    [503, "PROVIDER"],
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    const testServer = await startServer((_request, response) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: { message: "server detail" } }));
    });

    await expect(
      new OpenAICompatibleProvider().run(baseRequest(testServer.url), () => undefined),
    ).rejects.toMatchObject({ code });
  });

  it("maps malformed JSON and malformed stream events to safe provider errors", async () => {
    const jsonServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end("{not-json");
    });
    await expect(
      new OpenAICompatibleProvider().run(baseRequest(jsonServer.url), () => undefined),
    ).rejects.toMatchObject({ code: "PROVIDER" });

    const streamServer = await startServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.end("data: {broken-json}\n\n");
    });
    await expect(
      new OpenAICompatibleProvider().run(
        baseRequest(streamServer.url, { stream: true }),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER" });
  });

  it("redacts a configured credential from streamed output even when it is split", async () => {
    const credential = "provider-secret-value";
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.write(
        'data: {"choices":[{"delta":{"content":"provider-sec"}}]}\n\n',
      );
      response.end(
        'data: {"choices":[{"delta":{"content":"ret-value"}}]}\n\ndata: [DONE]\n\n',
      );
    });
    const deltas: string[] = [];

    const result = await new OpenAICompatibleProvider().run(
      baseRequest(testServer.url, { credential, stream: true }),
      (chunk) => deltas.push(chunk),
    );

    expect(result.text).toBe("[REDACTED]");
    expect(deltas.join("")).toBe("[REDACTED]");
    expect(JSON.stringify({ result, deltas })).not.toContain(credential);
  });

  it("redacts credentials from provider error details", async () => {
    const credential = "provider-secret-value";
    const testServer = await startServer((_request, response) => {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: { message: `request failed with ${credential}` },
        }),
      );
    });

    let thrown: unknown;
    try {
      await new OpenAICompatibleProvider().run(
        baseRequest(testServer.url, { credential }),
        () => undefined,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "PROVIDER", retryable: true });
    expect(JSON.stringify(thrown)).not.toContain(credential);
    expect(JSON.stringify(thrown)).toContain("[REDACTED]");
  });

  it("maps caller cancellation and timeouts to distinct safe errors", async () => {
    const controller = new AbortController();
    const testServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.flushHeaders();
    });
    const pending = new OpenAICompatibleProvider().run(
      baseRequest(testServer.url, { signal: controller.signal }),
      () => undefined,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
      retryable: true,
    });

    const timeoutServer = await startServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.flushHeaders();
    });
    await expect(
      new OpenAICompatibleProvider().run(
        baseRequest(timeoutServer.url, { timeoutMs: 20 }),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("maps local connection failures to OFFLINE", async () => {
    const testServer = await startServer((_request, response) => {
      response.end();
    });
    const url = testServer.url;
    await closeServer(testServer);

    await expect(
      new OllamaProvider().run(baseRequest(url), () => undefined),
    ).rejects.toMatchObject({ code: "OFFLINE", retryable: true });
  });

  it("rejects unsafe URLs and invalid request limits without echoing secrets", async () => {
    const adapter = new ProviderRegistry().get("ollama");
    const credentialInUrl = "embedded-secret";

    for (const baseUrl of [
      "file:///tmp/model",
      "http://user:password@127.0.0.1:11434",
      `http://user:${credentialInUrl}@127.0.0.1:11434`,
      "http://@127.0.0.1:11434",
    ]) {
      let thrown: unknown;
      try {
        await adapter.run(baseRequest(baseUrl), () => undefined);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: "VALIDATION" });
      expect(JSON.stringify(thrown)).not.toContain(credentialInUrl);
      expect(JSON.stringify(thrown)).not.toContain("password");
    }

    await expect(
      adapter.run(baseRequest("http://127.0.0.1:11434", { model: "  " }), () => undefined),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      adapter.run(
        baseRequest("http://127.0.0.1:11434", { prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) }),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      adapter.run(
        baseRequest("http://127.0.0.1:11434", {
          timeoutMs: MAX_PROVIDER_TIMEOUT_MS + 1,
        }),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
