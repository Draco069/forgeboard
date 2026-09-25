import { randomUUID } from "node:crypto";
import {
  AppErrorException,
  createAppError,
  normalizeAppError,
  redactSecrets,
} from "../shared/errors";
import type {
  AppError,
  Connection,
  RequestRecord,
  RunEvent,
} from "../shared/types";
import { MAX_PROMPT_LENGTH, MAX_RESPONSE_LENGTH } from "../shared/validation";
import {
  createSecretStreamFilter,
  normalizeProviderTimeout,
  ProviderRegistry,
} from "./providers";
import type { ProviderResult } from "./providers";
import type { ForgeboardStore } from "./store";

export interface RunInput {
  workspaceId?: string;
  promptId?: string;
  connectionId: string;
  renderedPrompt: string;
  stream?: boolean;
  timeoutMs?: number;
}

export interface RequestServiceOptions {
  idFactory?: () => string;
  now?: () => string;
}

interface ActiveRequest {
  controller: AbortController;
  timedOut: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface RequestContext {
  requestId: string;
  workspaceId: string;
  promptId?: string;
  connection: Connection;
  renderedPrompt: string;
  createdAt: string;
  startedAt: number;
}

function validationError(detail: string): AppErrorException {
  return new AppErrorException(createAppError("VALIDATION", detail));
}

function emitSafely(emit: (event: RunEvent) => void, event: RunEvent): void {
  try {
    emit(event);
  } catch {
    // Event delivery must not interrupt provider cancellation or persistence.
  }
}

function requireText(
  value: unknown,
  name: string,
  maximumLength: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${name} must not be blank.`);
  }
  const text = value.trim();
  if (text.length > maximumLength) {
    throw validationError(`${name} must be at most ${maximumLength} characters.`);
  }
  return text;
}

function unref(timeoutHandle: ReturnType<typeof setTimeout>): void {
  const unrefMethod = (timeoutHandle as unknown as { unref?: () => void }).unref;
  unrefMethod?.call(timeoutHandle);
}

function createRequestContext(
  store: ForgeboardStore,
  input: RunInput,
  idFactory: () => string,
  now: () => string,
): RequestContext {
  if (typeof input !== "object" || input === null) {
    throw validationError("Request input must be an object.");
  }
  const state = store.getState();
  const workspaceId = requireText(
    input.workspaceId ?? state.activeWorkspace.id,
    "Workspace id",
    200,
  );
  if (!state.document.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw validationError("The workspace could not be found.");
  }

  const connectionId = requireText(input.connectionId, "Connection id", 200);
  const connection = state.document.connections.find(
    (candidate) => candidate.id === connectionId,
  );
  if (!connection) {
    throw validationError("The connection could not be found.");
  }

  let promptId: string | undefined;
  if (input.promptId !== undefined) {
    promptId = requireText(input.promptId, "Prompt id", 200);
    const prompt = state.document.prompts.find((candidate) => candidate.id === promptId);
    if (!prompt || prompt.workspaceId !== workspaceId) {
      throw validationError("The prompt could not be found in the selected workspace.");
    }
  }

  if (
    typeof input.renderedPrompt !== "string" ||
    input.renderedPrompt.length > MAX_PROMPT_LENGTH
  ) {
    throw validationError(`Rendered prompt must be at most ${MAX_PROMPT_LENGTH} characters.`);
  }
  if (input.stream !== undefined && typeof input.stream !== "boolean") {
    throw validationError("Request stream option must be a boolean.");
  }
  normalizeProviderTimeout(input.timeoutMs);

  return {
    requestId: idFactory(),
    workspaceId,
    ...(promptId ? { promptId } : {}),
    connection,
    renderedPrompt: input.renderedPrompt,
    createdAt: now(),
    startedAt: Date.now(),
  };
}

function requestRecord(
  context: RequestContext,
  values: Pick<RequestRecord, "response" | "status" | "model" | "renderedPrompt"> & {
    errorMessage?: string;
  },
  durationMs: number,
): RequestRecord {
  return {
    id: context.requestId,
    workspaceId: context.workspaceId,
    ...(context.promptId ? { promptId: context.promptId } : {}),
    connectionId: context.connection.id,
    provider: context.connection.provider,
    model: values.model,
    renderedPrompt: values.renderedPrompt,
    response: values.response,
    status: values.status,
    ...(values.errorMessage ? { errorMessage: values.errorMessage } : {}),
    durationMs,
    createdAt: context.createdAt,
  };
}

function validateProviderResult(result: ProviderResult, credential?: string): string {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.text !== "string" ||
    result.text.length > MAX_RESPONSE_LENGTH
  ) {
    throw new AppErrorException(
      createAppError("PROVIDER", "Provider returned a malformed response."),
    );
  }
  return redactSecrets(result.text, credential ? [credential] : []);
}

function normalizeRunError(
  error: unknown,
  activeRequest: ActiveRequest,
  credential: string | undefined,
): AppError {
  if (activeRequest.timedOut) {
    return normalizeAppError(
      createAppError("TIMEOUT", "The request exceeded its configured timeout."),
      credential ? [credential] : [],
    );
  }
  if (activeRequest.controller.signal.aborted) {
    return normalizeAppError(
      createAppError("CANCELLED", "The request was cancelled."),
      credential ? [credential] : [],
    );
  }

  const normalized = normalizeAppError(error, credential ? [credential] : []);
  if (normalized.code === "UNKNOWN") {
    return normalizeAppError(
      createAppError("PROVIDER", normalized.detail),
      credential ? [credential] : [],
    );
  }
  return normalized;
}

function withCredentialRedaction(
  error: AppError,
  credential: string | undefined,
): AppError {
  return normalizeAppError(error, credential ? [credential] : []);
}

export class RequestService {
  private readonly store: ForgeboardStore;
  private readonly registry: ProviderRegistry;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly activeRequests = new Map<string, ActiveRequest>();

  constructor(
    store: ForgeboardStore,
    registry: ProviderRegistry = new ProviderRegistry(),
    options: RequestServiceOptions = {},
  ) {
    this.store = store;
    this.registry = registry;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  cancel(requestId: string): boolean {
    const activeRequest = this.activeRequests.get(requestId);
    if (!activeRequest) {
      return false;
    }
    activeRequest.controller.abort();
    return true;
  }

  async run(input: RunInput, emit: (event: RunEvent) => void): Promise<RequestRecord> {
    if (typeof emit !== "function") {
      throw validationError("Run event emitter must be a function.");
    }

    const context = createRequestContext(
      this.store,
      input,
      this.idFactory,
      this.now,
    );
    const adapter = this.registry.get(context.connection.provider);
    const timeoutMs = normalizeProviderTimeout(input.timeoutMs);
    const credential = await this.store.credentials.get(context.connection.id);
    const secrets = credential ? [credential] : [];
    const safeModel = redactSecrets(context.connection.model, secrets);
    const safePrompt = redactSecrets(context.renderedPrompt, secrets);
    const responseFilter = createSecretStreamFilter(secrets);
    let streamedResponse = "";

    const appendResponse = (value: string, emitDelta = false): void => {
      if (value.length === 0) {
        return;
      }
      if (streamedResponse.length + value.length > MAX_RESPONSE_LENGTH) {
        throw new AppErrorException(
          createAppError(
            "PROVIDER",
            `Provider response exceeded the ${MAX_RESPONSE_LENGTH}-character limit.`,
          ),
        );
      }
      streamedResponse += value;
      if (emitDelta) {
        emitSafely(emit, {
          type: "delta",
          requestId: context.requestId,
          text: value,
        });
      }
    };

    const controller = new AbortController();
    const activeRequest: ActiveRequest = {
      controller,
      timedOut: false,
      timeoutHandle: setTimeout(() => {
        activeRequest.timedOut = true;
        controller.abort();
      }, timeoutMs),
    };
    unref(activeRequest.timeoutHandle);
    this.activeRequests.set(context.requestId, activeRequest);

    emitSafely(emit, {
      type: "started",
      requestId: context.requestId,
      createdAt: context.createdAt,
      workspaceId: context.workspaceId,
      ...(context.promptId ? { promptId: context.promptId } : {}),
      connectionId: context.connection.id,
      provider: context.connection.provider,
      model: safeModel,
    });

    try {
      const result = await adapter.run(
        {
          baseUrl: context.connection.baseUrl,
          model: context.connection.model,
          prompt: context.renderedPrompt,
          ...(credential ? { credential } : {}),
          signal: controller.signal,
          stream: input.stream ?? true,
          timeoutMs,
        },
        (chunk) => {
          if (typeof chunk !== "string") {
            throw new AppErrorException(
              createAppError("PROVIDER", "Provider emitted a malformed response chunk."),
            );
          }
          appendResponse(responseFilter.push(chunk), true);
        },
      );
      const response = validateProviderResult(result, credential);
      responseFilter.finish();
      streamedResponse = response;
      if (activeRequest.timedOut || controller.signal.aborted) {
        throw new AppErrorException(
          createAppError(
            activeRequest.timedOut ? "TIMEOUT" : "CANCELLED",
            activeRequest.timedOut
              ? "The request exceeded its configured timeout."
              : "The request was cancelled.",
          ),
        );
      }
      const record = requestRecord(
        context,
        {
          response,
          status: "success",
          model: safeModel,
          renderedPrompt: safePrompt,
        },
        Math.max(0, Date.now() - context.startedAt),
      );
      const persisted = await this.store.saveRequest(record);
      if (activeRequest.timedOut || controller.signal.aborted) {
        throw new AppErrorException(
          createAppError(
            activeRequest.timedOut ? "TIMEOUT" : "CANCELLED",
            activeRequest.timedOut
              ? "The request exceeded its configured timeout."
              : "The request was cancelled.",
          ),
        );
      }
      emitSafely(emit, {
        type: "completed",
        requestId: context.requestId,
        record: persisted,
      });
      return persisted;
    } catch (error) {
      const trailingResponse = responseFilter.finish();
      if (trailingResponse.length > 0) {
        const available = Math.max(0, MAX_RESPONSE_LENGTH - streamedResponse.length);
        appendResponse(trailingResponse.slice(0, available));
      }

      let appError = withCredentialRedaction(
        normalizeRunError(error, activeRequest, credential),
        credential,
      );
      if (appError.code === "UNKNOWN") {
        appError = withCredentialRedaction(
          createAppError("PROVIDER", appError.detail),
          credential,
        );
      }
      const cancelled = appError.code === "CANCELLED";
      const durationMs = Math.max(0, Date.now() - context.startedAt);
      const candidate = requestRecord(
        context,
        {
          response: streamedResponse,
          status: cancelled ? "cancelled" : "error",
          model: safeModel,
          renderedPrompt: safePrompt,
          errorMessage: appError.message,
        },
        durationMs,
      );

      let record: RequestRecord;
      try {
        record = await this.store.saveRequest(candidate);
      } catch (persistenceError) {
        appError = withCredentialRedaction(
          normalizeAppError(persistenceError, secrets),
          credential,
        );
        emitSafely(emit, {
          type: "error",
          requestId: context.requestId,
          error: appError,
          record: { ...candidate, errorMessage: appError.message },
        });
        throw new AppErrorException(appError);
      }

      if (cancelled) {
        emitSafely(emit, {
          type: "cancelled",
          requestId: context.requestId,
          record,
        });
      } else {
        emitSafely(emit, {
          type: "error",
          requestId: context.requestId,
          error: appError,
          record,
        });
      }
      throw new AppErrorException(appError);
    } finally {
      clearTimeout(activeRequest.timeoutHandle);
      if (this.activeRequests.get(context.requestId) === activeRequest) {
        this.activeRequests.delete(context.requestId);
      }
    }
  }
}
