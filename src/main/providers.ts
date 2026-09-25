import {
  AppErrorException,
  createAppError,
  normalizeAppError,
  redactSecrets,
} from "../shared/errors";
import type { AppErrorCode, ProviderKind } from "../shared/types";
import {
  httpUrlSchema,
  MAX_PROMPT_LENGTH,
  MAX_RESPONSE_LENGTH,
} from "../shared/validation";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
export const MAX_PROVIDER_TIMEOUT_MS = 60_000;
const MAX_MODEL_LENGTH = 200;
const MAX_STREAM_LINE_LENGTH = MAX_RESPONSE_LENGTH * 2;
const MAX_METADATA_DEPTH = 3;

export type FetchImplementation = typeof globalThis.fetch;
export type ProviderDeltaHandler = (chunk: string) => void;
export type ProviderMetadata = Readonly<Record<string, unknown>>;

export interface ProviderRequest {
  baseUrl: string;
  model: string;
  prompt: string;
  credential?: string;
  signal: AbortSignal;
  stream?: boolean;
  timeoutMs?: number;
}

export interface ProviderResult {
  text: string;
  model: string;
  metadata?: ProviderMetadata;
}

export interface ProviderAdapter {
  run(request: ProviderRequest, onDelta: ProviderDeltaHandler): Promise<ProviderResult>;
}

export interface ProviderRegistryOptions {
  fetch?: FetchImplementation;
  adapters?: Partial<Record<ProviderKind, ProviderAdapter>>;
}

interface ValidatedProviderRequest extends ProviderRequest {
  baseUrl: string;
  model: string;
  stream: boolean;
  timeoutMs: number;
}

interface LinkedAbortSignal {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

interface ResponseAccumulator {
  readonly text: string;
  readonly model: string;
  readonly metadata: ProviderMetadata | undefined;
  appendContent: (content: string) => void;
  finish: () => ProviderResult;
  observeModel: (model: unknown) => void;
  observeMetadata: (metadata: Record<string, unknown>) => void;
}

export interface SecretStreamFilter {
  push: (value: string) => string;
  finish: () => string;
}

function validationError(detail: string): AppErrorException {
  return new AppErrorException(createAppError("VALIDATION", detail));
}

function secretList(credential: string | undefined): string[] {
  return credential ? [credential] : [];
}

function safeAppError(
  code: AppErrorCode,
  detail: string,
  credential: string | undefined,
): AppErrorException {
  const secrets = secretList(credential);
  const safeDetail = redactSecrets(detail, secrets);
  return new AppErrorException(
    normalizeAppError(createAppError(code, safeDetail), secrets),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function hasEmbeddedCredentials(baseUrl: string): boolean {
  const authority = /^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/?#]*)/.exec(baseUrl)?.[1];
  return authority?.includes("@") ?? false;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  const record = asRecord(value);
  return (
    typeof record?.aborted === "boolean" &&
    typeof record.addEventListener === "function" &&
    typeof record.removeEventListener === "function"
  );
}

export function normalizeProviderTimeout(timeoutMs?: number): number {
  const value = timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PROVIDER_TIMEOUT_MS) {
    throw validationError(
      `Provider timeout must be between 1 and ${MAX_PROVIDER_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value;
}

function validateProviderRequest(request: ProviderRequest): ValidatedProviderRequest {
  if (typeof request !== "object" || request === null) {
    throw validationError("Provider request must be an object.");
  }

  if (typeof request.baseUrl !== "string") {
    throw validationError("Provider base URL must be text.");
  }
  const baseUrl = request.baseUrl.trim();
  if (hasEmbeddedCredentials(baseUrl) || !httpUrlSchema.safeParse(baseUrl).success) {
    throw validationError(
      "Provider URL must be an absolute HTTP(S) URL without embedded credentials.",
    );
  }

  if (typeof request.model !== "string" || request.model.trim().length === 0) {
    throw validationError("Provider model must not be blank.");
  }
  const model = request.model.trim();
  if (model.length > MAX_MODEL_LENGTH) {
    throw validationError(`Provider model must be at most ${MAX_MODEL_LENGTH} characters.`);
  }

  if (typeof request.prompt !== "string" || request.prompt.length > MAX_PROMPT_LENGTH) {
    throw validationError(`Provider prompt must be at most ${MAX_PROMPT_LENGTH} characters.`);
  }

  if (request.credential !== undefined && typeof request.credential !== "string") {
    throw validationError("Provider credential must be text.");
  }
  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    throw validationError("Provider stream option must be a boolean.");
  }
  if (!isAbortSignal(request.signal)) {
    throw validationError("Provider request must include an AbortSignal.");
  }

  return {
    ...request,
    baseUrl,
    model,
    credential:
      typeof request.credential === "string" && request.credential.length > 0
        ? request.credential
        : undefined,
    stream: request.stream ?? true,
    timeoutMs: normalizeProviderTimeout(request.timeoutMs),
  };
}

function buildEndpointUrl(baseUrl: string, endpointPath: string): URL {
  const url = new URL(baseUrl);
  const pathPrefix = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathPrefix}${endpointPath}`;
  return url;
}

function createLinkedAbortSignal(
  externalSignal: AbortSignal,
  timeoutMs: number,
): LinkedAbortSignal {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromExternalSignal = (): void => {
    controller.abort();
  };
  if (externalSignal.aborted) {
    controller.abort();
  } else {
    externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const unref = (timeoutHandle as unknown as { unref?: () => void }).unref;
  unref?.call(timeoutHandle);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutHandle);
      externalSignal.removeEventListener("abort", abortFromExternalSignal);
    },
  };
}

function isAbortError(error: unknown): boolean {
  const record = asRecord(error);
  const name = typeof record?.name === "string" ? record.name.toLowerCase() : "";
  const code = typeof record?.code === "string" ? record.code.toLowerCase() : "";
  return name === "aborterror" || code === "abort_err" || code === "err_aborted";
}

function normalizeThrownError(
  error: unknown,
  linkedSignal: LinkedAbortSignal,
  externalSignal: AbortSignal,
  credential: string | undefined,
): AppErrorException {
  if (linkedSignal.timedOut()) {
    return safeAppError("TIMEOUT", "The provider request exceeded its timeout.", credential);
  }
  if (externalSignal.aborted || isAbortError(error)) {
    return safeAppError("CANCELLED", "The provider request was cancelled.", credential);
  }

  const normalized = normalizeAppError(error, secretList(credential));
  if (
    normalized.code === "TIMEOUT" ||
    normalized.code === "CANCELLED" ||
    normalized.code === "OFFLINE" ||
    normalized.code === "VALIDATION" ||
    (normalized.code !== "UNKNOWN" && normalized.code !== "PROVIDER")
  ) {
    return new AppErrorException(normalized);
  }

  if (normalized.code === "PROVIDER") {
    return new AppErrorException(normalized);
  }

  return safeAppError(
    "OFFLINE",
    normalized.detail ?? "The provider network request failed.",
    credential,
  );
}

function sanitizeMetadataValue(
  value: unknown,
  secrets: string[],
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, secrets);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (depth >= MAX_METADATA_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeMetadataValue(item, secrets, depth + 1))
      .filter((item) => item !== undefined);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, 100)) {
    const sanitizedKey = redactSecrets(key, secrets);
    const sanitizedValue = sanitizeMetadataValue(item, secrets, depth + 1);
    if (sanitizedValue !== undefined) {
      sanitized[sanitizedKey] = sanitizedValue;
    }
  }
  return sanitized;
}

export function createSecretStreamFilter(secrets: string[]): SecretStreamFilter {
  const uniqueSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  const maxSecretLength = uniqueSecrets[0]?.length ?? 0;
  let pending = "";

  const heldPrefixLength = (): number => {
    if (uniqueSecrets.length === 0) {
      return 0;
    }
    const earliestStart = Math.max(0, pending.length - maxSecretLength);
    for (let start = earliestStart; start < pending.length; start += 1) {
      const suffix = pending.slice(start);
      if (uniqueSecrets.some((secret) => secret.startsWith(suffix))) {
        return suffix.length;
      }
    }
    return 0;
  };

  return {
    push: (value: string): string => {
      pending += value;
      const holdLength = heldPrefixLength();
      if (holdLength === 0) {
        const emitted = redactSecrets(pending, uniqueSecrets);
        pending = "";
        return emitted;
      }
      const emittedLength = pending.length - holdLength;
      const emitted = redactSecrets(pending.slice(0, emittedLength), uniqueSecrets);
      pending = pending.slice(emittedLength);
      return emitted;
    },
    finish: (): string => {
      const emitted = redactSecrets(pending, uniqueSecrets);
      pending = "";
      return emitted;
    },
  };
}

function createResponseAccumulator(
  fallbackModel: string,
  credential: string | undefined,
  emitDeltas: boolean,
  onDelta: ProviderDeltaHandler,
): ResponseAccumulator {
  const secrets = secretList(credential);
  const filter = createSecretStreamFilter(secrets);
  const metadata: Record<string, unknown> = {};
  let text = "";
  let model = fallbackModel;
  let finished = false;

  const appendSafeText = (value: string, emitDelta = false): void => {
    if (value.length === 0) {
      return;
    }
    if (text.length + value.length > MAX_RESPONSE_LENGTH) {
      throw safeAppError(
        "PROVIDER",
        `Provider response exceeded the ${MAX_RESPONSE_LENGTH}-character limit.`,
        credential,
      );
    }
    text += value;
    if (emitDelta) {
      onDelta(value);
    }
  };

  return {
    get text() {
      return text;
    },
    get model() {
      return model;
    },
    get metadata() {
      return Object.keys(metadata).length > 0 ? metadata : undefined;
    },
    appendContent: (content: string): void => {
      appendSafeText(filter.push(content), emitDeltas);
    },
    finish: (): ProviderResult => {
      if (!finished) {
        appendSafeText(filter.finish(), emitDeltas);
        finished = true;
      }
      return {
        text,
        model,
        ...(Object.keys(metadata).length > 0 ? { metadata } : undefined),
      };
    },
    observeModel: (value: unknown): void => {
      if (typeof value !== "string" || value.trim().length === 0) {
        return;
      }
      const safeModel = redactSecrets(value, secrets).trim();
      if (safeModel.length > 0) {
        model = safeModel;
      }
    },
    observeMetadata: (value: Record<string, unknown>): void => {
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) {
          continue;
        }
        const safeValue = sanitizeMetadataValue(item, secrets);
        if (safeValue !== undefined) {
          metadata[redactSecrets(key, secrets)] = safeValue;
        }
      }
    },
  };
}

function providerErrorFromRecord(
  record: Record<string, unknown>,
  credential: string | undefined,
): AppErrorException {
  const errorValue = record.error;
  const directError = asRecord(errorValue);
  const nestedMessage =
    typeof errorValue === "string"
      ? errorValue
      : typeof directError?.message === "string"
        ? directError.message
        : typeof record.message === "string"
          ? record.message
          : undefined;
  const detail = nestedMessage
    ? `Provider returned an error: ${nestedMessage}`
    : "Provider returned an error response.";
  return safeAppError("PROVIDER", detail, credential);
}

function malformedResponse(credential: string | undefined): AppErrorException {
  return safeAppError("PROVIDER", "Provider returned a malformed response.", credential);
}

function parseJsonRecord(
  value: string,
  credential: string | undefined,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw malformedResponse(credential);
  }
  const record = asRecord(parsed);
  if (!record) {
    throw malformedResponse(credential);
  }
  return record;
}

async function readBoundedText(
  response: Response,
  credential: string | undefined,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_LENGTH) {
    throw malformedResponse(credential);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_LENGTH) {
    throw malformedResponse(credential);
  }
  return text;
}

async function readResponseLines(
  response: Response,
  onLine: (line: string) => void,
  credential: string | undefined,
): Promise<void> {
  const processLine = (line: string): void => {
    if (line.length > MAX_STREAM_LINE_LENGTH) {
      throw malformedResponse(credential);
    }
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  if (!response.body) {
    const text = await readBoundedText(response, credential);
    for (const line of text.split("\n")) {
      processLine(line);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        processLine(pending.slice(0, newlineIndex));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
      if (pending.length > MAX_STREAM_LINE_LENGTH) {
        throw malformedResponse(credential);
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) {
      processLine(pending);
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function statusErrorCode(status: number): AppErrorCode {
  if (status === 401 || status === 403) {
    return "AUTHENTICATION";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  return "PROVIDER";
}

async function httpFailure(
  response: Response,
  credential: string | undefined,
): Promise<AppErrorException> {
  let providerMessage: string | undefined;
  try {
    const body = await readBoundedText(response, credential);
    const parsed = parseJsonRecord(body, credential);
    const errorValue = parsed.error;
    const errorRecord = asRecord(errorValue);
    if (typeof errorValue === "string") {
      providerMessage = errorValue;
    } else if (typeof errorRecord?.message === "string") {
      providerMessage = errorRecord.message;
    } else if (typeof parsed.message === "string") {
      providerMessage = parsed.message;
    }
  } catch {
    providerMessage = undefined;
  }

  const suffix = providerMessage ? `: ${providerMessage}` : "";
  return safeAppError(
    statusErrorCode(response.status),
    `Provider request failed with HTTP ${response.status}${suffix}.`,
    credential,
  );
}

function extractOpenAIJson(
  record: Record<string, unknown>,
  accumulator: ResponseAccumulator,
  credential: string | undefined,
): void {
  if (record.error !== undefined) {
    throw providerErrorFromRecord(record, credential);
  }
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw malformedResponse(credential);
  }
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  if (!message || typeof message.content !== "string") {
    throw malformedResponse(credential);
  }

  accumulator.appendContent(message.content);
  accumulator.observeModel(record.model);
  accumulator.observeMetadata({
    responseId: record.id,
    finishReason: choice?.finish_reason,
    usage: record.usage,
  });
}

function extractOllamaJson(
  record: Record<string, unknown>,
  accumulator: ResponseAccumulator,
  credential: string | undefined,
): void {
  if (record.error !== undefined) {
    throw providerErrorFromRecord(record, credential);
  }
  const message = asRecord(record.message);
  if (!message || typeof message.content !== "string") {
    throw malformedResponse(credential);
  }

  accumulator.appendContent(message.content);
  accumulator.observeModel(record.model);
  accumulator.observeMetadata({
    done: record.done,
    doneReason: record.done_reason,
    evalCount: record.eval_count,
    totalDuration: record.total_duration,
  });
}

function extractOpenAISseData(
  data: string,
  accumulator: ResponseAccumulator,
  credential: string | undefined,
): void {
  const trimmed = data.trim();
  if (trimmed.length === 0 || trimmed === "[DONE]") {
    return;
  }
  const record = parseJsonRecord(trimmed, credential);
  if (record.error !== undefined) {
    throw providerErrorFromRecord(record, credential);
  }

  const choices = record.choices;
  if (choices === undefined) {
    if (record.usage !== undefined) {
      accumulator.observeMetadata({ usage: record.usage });
      accumulator.observeModel(record.model);
      return;
    }
    throw malformedResponse(credential);
  }
  if (!Array.isArray(choices)) {
    throw malformedResponse(credential);
  }
  if (choices.length === 0) {
    accumulator.observeMetadata({ usage: record.usage });
    accumulator.observeModel(record.model);
    return;
  }

  const choice = asRecord(choices[0]);
  const delta = asRecord(choice?.delta);
  if (delta === undefined) {
    if (typeof choice?.finish_reason === "string") {
      accumulator.observeMetadata({ finishReason: choice.finish_reason });
      return;
    }
    throw malformedResponse(credential);
  }
  if (delta.content !== undefined && typeof delta.content !== "string") {
    throw malformedResponse(credential);
  }
  if (typeof delta.content === "string") {
    accumulator.appendContent(delta.content);
  }
  accumulator.observeModel(record.model);
  accumulator.observeMetadata({
    responseId: record.id,
    finishReason: choice?.finish_reason,
    usage: record.usage,
  });
}

function extractOllamaStreamRecord(
  record: Record<string, unknown>,
  accumulator: ResponseAccumulator,
  credential: string | undefined,
): void {
  if (record.error !== undefined) {
    throw providerErrorFromRecord(record, credential);
  }

  const message = asRecord(record.message);
  if (message !== undefined && message.content !== undefined) {
    if (typeof message.content !== "string") {
      throw malformedResponse(credential);
    }
    accumulator.appendContent(message.content);
  } else if (record.done !== true) {
    throw malformedResponse(credential);
  }

  accumulator.observeModel(record.model);
  accumulator.observeMetadata({
    done: record.done,
    doneReason: record.done_reason,
    evalCount: record.eval_count,
    totalDuration: record.total_duration,
  });
}

abstract class HttpProviderAdapter implements ProviderAdapter {
  private readonly fetchImplementation: FetchImplementation;

  constructor(fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis)) {
    this.fetchImplementation = fetchImplementation;
  }

  async run(request: ProviderRequest, onDelta: ProviderDeltaHandler): Promise<ProviderResult> {
    if (typeof onDelta !== "function") {
      throw validationError("Provider delta handler must be a function.");
    }
    const validated = validateProviderRequest(request);
    const linkedSignal = createLinkedAbortSignal(validated.signal, validated.timeoutMs);
    const accumulator = createResponseAccumulator(
      validated.model,
      validated.credential,
      validated.stream,
      onDelta,
    );

    try {
      const response = await this.fetchImplementation(buildEndpointUrl(validated.baseUrl, this.endpointPath), {
        method: "POST",
        headers: this.headers(validated),
        body: JSON.stringify({
          model: validated.model,
          messages: [{ role: "user", content: validated.prompt }],
          stream: validated.stream,
        }),
        signal: linkedSignal.signal,
      });
      if (!response.ok) {
        throw await httpFailure(response, validated.credential);
      }

      const result = validated.stream
        ? await this.parseStreamingResponse(response, accumulator, validated.credential)
        : await this.parseJsonResponse(response, accumulator, validated.credential);
      const safeResult = { ...result, text: redactSecrets(result.text, secretList(validated.credential)) };
      if (safeResult.text.length > MAX_RESPONSE_LENGTH) {
        throw safeAppError(
          "PROVIDER",
          `Provider response exceeded the ${MAX_RESPONSE_LENGTH}-character limit.`,
          validated.credential,
        );
      }
      return safeResult;
    } catch (error) {
      throw normalizeThrownError(
        error,
        linkedSignal,
        validated.signal,
        validated.credential,
      );
    } finally {
      linkedSignal.cleanup();
    }
  }

  protected abstract get endpointPath(): string;
  protected abstract headers(request: ValidatedProviderRequest): Record<string, string>;
  protected abstract parseJsonResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult>;
  protected abstract parseStreamingResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult>;

  protected async readJson(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<Record<string, unknown>> {
    const text = await readBoundedText(response, credential);
    return parseJsonRecord(text, credential);
  }
}

export class OllamaProvider extends HttpProviderAdapter {
  protected get endpointPath(): string {
    return "/api/chat";
  }

  protected headers(request: ValidatedProviderRequest): Record<string, string> {
    return {
      Accept: request.stream
        ? "application/x-ndjson, application/json"
        : "application/json",
      "Content-Type": "application/json",
    };
  }

  protected async parseJsonResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult> {
    const record = await this.readJson(response, accumulator, credential);
    extractOllamaJson(record, accumulator, credential);
    return accumulator.finish();
  }

  protected async parseStreamingResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult> {
    await readResponseLines(
      response,
      (line) => {
        if (line.trim().length === 0) {
          return;
        }
        const record = parseJsonRecord(line, credential);
        extractOllamaStreamRecord(record, accumulator, credential);
      },
      credential,
    );
    return accumulator.finish();
  }
}

export class OpenAICompatibleProvider extends HttpProviderAdapter {
  protected get endpointPath(): string {
    return "/chat/completions";
  }

  protected headers(request: ValidatedProviderRequest): Record<string, string> {
    return {
      Accept: request.stream ? "text/event-stream, application/json" : "application/json",
      "Content-Type": "application/json",
      ...(request.credential ? { Authorization: `Bearer ${request.credential}` } : {}),
    };
  }

  protected async parseJsonResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult> {
    const record = await this.readJson(response, accumulator, credential);
    extractOpenAIJson(record, accumulator, credential);
    return accumulator.finish();
  }

  protected async parseStreamingResponse(
    response: Response,
    accumulator: ResponseAccumulator,
    credential: string | undefined,
  ): Promise<ProviderResult> {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("json")) {
      const record = await this.readJson(response, accumulator, credential);
      extractOpenAIJson(record, accumulator, credential);
      return accumulator.finish();
    }

    let mode: "sse" | "json-lines" | undefined;
    let dataLines: string[] = [];
    const dispatchSseEvent = (): void => {
      if (dataLines.length === 0) {
        return;
      }
      const data = dataLines.join("\n");
      dataLines = [];
      extractOpenAISseData(data, accumulator, credential);
    };
    const feedSseLine = (line: string): void => {
      if (line.length === 0) {
        dispatchSseEvent();
        return;
      }
      if (line.startsWith(":")) {
        return;
      }
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      if (field !== "data") {
        return;
      }
      const value = separator === -1 ? "" : line.slice(separator + 1);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    };

    await readResponseLines(
      response,
      (line) => {
        const trimmed = line.trim();
        if (mode === undefined && trimmed.length > 0) {
          const looksLikeSse = /^(?:data|event|id|retry):/.test(trimmed) || trimmed.startsWith(":");
          mode = looksLikeSse ? "sse" : "json-lines";
        }
        if (mode === "sse") {
          feedSseLine(line);
          return;
        }
        if (trimmed.length === 0) {
          return;
        }
        const record = parseJsonRecord(trimmed, credential);
        extractOpenAIJson(record, accumulator, credential);
      },
      credential,
    );
    if (mode === "sse") {
      dispatchSseEvent();
    }
    return accumulator.finish();
  }
}

export class ProviderRegistry {
  private readonly adapters: Record<ProviderKind, ProviderAdapter>;

  constructor(options: ProviderRegistryOptions = {}) {
    const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.adapters = {
      ollama: options.adapters?.ollama ?? new OllamaProvider(fetchImplementation),
      "openai-compatible":
        options.adapters?.["openai-compatible"] ??
        new OpenAICompatibleProvider(fetchImplementation),
    };
  }

  get(kind: ProviderKind): ProviderAdapter {
    const adapter = this.adapters[kind];
    if (!adapter) {
      throw validationError("Provider kind is not supported.");
    }
    return adapter;
  }
}
