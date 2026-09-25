import type {
  AppError,
  AppState,
  ProviderKind,
  RequestRecord,
  RunEvent,
  Theme,
} from "../shared/types";

export type ForgeboardView = "prompts" | "history" | "settings";

export type LiveRunStatus = "running" | "success" | "error" | "cancelled";

export interface LiveRun {
  requestId: string;
  workspaceId: string;
  promptId?: string;
  connectionId: string;
  provider: ProviderKind;
  model: string;
  createdAt: string;
  response: string;
  status: LiveRunStatus;
  error?: AppError;
  record?: RequestRecord;
}

export interface RendererState extends AppState {
  view: ForgeboardView;
  selectedPromptId: string | undefined;
  selectedRequestId: string | undefined;
  search: string;
  theme: Theme;
  activeRuns: Record<string, LiveRun>;
  /** The most recently started or updated run, kept for compact status surfaces. */
  activeRun: LiveRun | null;
}

export type RendererAction =
  | { type: "state/loaded"; payload: AppState }
  | { type: "view/set"; view: ForgeboardView }
  | { type: "prompt/select"; promptId: string | undefined }
  | { type: "request/select"; requestId: string | undefined }
  | { type: "search/set"; search: string }
  | { type: "theme/set"; theme: Theme }
  | { type: "run-event"; event: RunEvent };

const loadingTimestamp = "1970-01-01T00:00:00.000Z";

export function createLoadingRendererState(): RendererState {
  const workspace = {
    id: "loading-workspace",
    name: "Loading workspace",
    createdAt: loadingTimestamp,
    updatedAt: loadingTimestamp,
  };

  return createRendererState({
    document: {
      schemaVersion: 1,
      workspaces: [workspace],
      prompts: [],
      connections: [],
      requests: [],
      settings: { theme: "system" },
      activeWorkspaceId: workspace.id,
    },
    activeWorkspace: workspace,
    credentialsAvailable: false,
  });
}

export function createRendererState(
  appState: AppState,
  previousState?: RendererState | null,
): RendererState {
  const prompts = new Set(appState.document.prompts.map((prompt) => prompt.id));
  const requests = new Set(appState.document.requests.map((request) => request.id));
  const previousPromptId = previousState?.selectedPromptId;
  const previousRequestId = previousState?.selectedRequestId;

  return {
    ...appState,
    view: previousState?.view ?? "prompts",
    selectedPromptId:
      previousPromptId && prompts.has(previousPromptId) ? previousPromptId : undefined,
    selectedRequestId:
      previousRequestId && requests.has(previousRequestId) ? previousRequestId : undefined,
    search: previousState?.search ?? "",
    theme: appState.document.settings.theme,
    activeRuns: previousState?.activeRuns ?? {},
    activeRun: previousState?.activeRun ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function isStartedEvent(event: Record<string, unknown>): boolean {
  return (
    hasString(event, "requestId") &&
    hasString(event, "createdAt") &&
    hasString(event, "workspaceId") &&
    hasString(event, "connectionId") &&
    hasString(event, "model") &&
    (event.provider === "ollama" || event.provider === "openai-compatible") &&
    (event.promptId === undefined || typeof event.promptId === "string")
  );
}

function isRequestRecord(value: unknown): value is RequestRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasString(value, "id") &&
    hasString(value, "workspaceId") &&
    hasString(value, "connectionId") &&
    hasString(value, "model") &&
    hasString(value, "renderedPrompt") &&
    hasString(value, "response") &&
    hasString(value, "createdAt") &&
    (value.provider === "ollama" || value.provider === "openai-compatible") &&
    (value.status === "success" || value.status === "error" || value.status === "cancelled") &&
    (value.promptId === undefined || typeof value.promptId === "string")
  );
}

function isSafeRunEvent(value: unknown): value is RunEvent {
  if (!isRecord(value) || !hasString(value, "requestId")) {
    return false;
  }

  switch (value.type) {
    case "started":
      return isStartedEvent(value);
    case "delta":
      return hasString(value, "text");
    case "completed":
    case "cancelled":
      return isRequestRecord(value.record);
    case "error":
      return (
        isRequestRecord(value.record) &&
        isRecord(value.error) &&
        hasString(value.error, "code") &&
        hasString(value.error, "message") &&
        typeof value.error.retryable === "boolean"
      );
    default:
      return false;
  }
}

function startedRun(event: Extract<RunEvent, { type: "started" }>): LiveRun {
  return {
    requestId: event.requestId,
    workspaceId: event.workspaceId,
    ...(event.promptId ? { promptId: event.promptId } : {}),
    connectionId: event.connectionId,
    provider: event.provider,
    model: event.model,
    createdAt: event.createdAt,
    response: "",
    status: "running",
  };
}

function requestRunStatus(event: Extract<RunEvent, { type: "completed" | "cancelled" | "error" }>): LiveRunStatus {
  if (event.type === "completed") {
    return "success";
  }
  if (event.type === "cancelled") {
    return "cancelled";
  }
  return "error";
}

function updateActiveRun(
  state: RendererState,
  run: LiveRun,
  record?: RequestRecord,
): RendererState {
  const activeRuns = {
    ...state.activeRuns,
    [run.requestId]: run,
  };
  const requests = record
    ? state.document.requests.some((request) => request.id === record.id)
      ? state.document.requests.map((request) => (request.id === record.id ? record : request))
      : [...state.document.requests, record]
    : state.document.requests;

  return {
    ...state,
    activeRuns,
    activeRun: run,
    document: record ? { ...state.document, requests } : state.document,
  };
}

function reduceRunEvent(state: RendererState, event: RunEvent): RendererState {
  if (!isSafeRunEvent(event)) {
    return state;
  }

  const current = state.activeRuns[event.requestId];

  if (event.type === "started") {
    return updateActiveRun(state, startedRun(event));
  }

  if (event.type === "delta") {
    if (!current) {
      return state;
    }
    return updateActiveRun(state, {
      ...current,
      response: `${current.response}${event.text}`,
    });
  }

  const status = requestRunStatus(event);
  const record = event.record;
  const run: LiveRun = current
    ? {
        ...current,
        workspaceId: record.workspaceId,
        ...(record.promptId ? { promptId: record.promptId } : {}),
        connectionId: record.connectionId,
        provider: record.provider,
        model: record.model,
        response: record.response || current.response,
        status,
        record,
        ...(event.type === "error" ? { error: event.error } : {}),
      }
    : {
        requestId: event.requestId,
        workspaceId: record.workspaceId,
        ...(record.promptId ? { promptId: record.promptId } : {}),
        connectionId: record.connectionId,
        provider: record.provider,
        model: record.model,
        createdAt: record.createdAt,
        response: record.response,
        status,
        record,
        ...(event.type === "error" ? { error: event.error } : {}),
      };

  return updateActiveRun(state, run, record);
}

export function rendererReducer(
  state: RendererState | null,
  action: RendererAction,
): RendererState | null {
  if (action.type === "state/loaded") {
    return createRendererState(action.payload, state);
  }

  if (!state) {
    return state;
  }

  switch (action.type) {
    case "view/set":
      return { ...state, view: action.view };
    case "prompt/select":
      return { ...state, selectedPromptId: action.promptId };
    case "request/select":
      return { ...state, selectedRequestId: action.requestId };
    case "search/set":
      return { ...state, search: action.search };
    case "theme/set":
      return {
        ...state,
        theme: action.theme,
        document: {
          ...state.document,
          settings: { ...state.document.settings, theme: action.theme },
        },
      };
    case "run-event":
      return reduceRunEvent(state, action.event);
    default:
      return state;
  }
}
