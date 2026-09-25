import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AppErrorException,
  createAppError,
  normalizeAppError,
  redactSecrets,
} from "../shared/errors";
import { extractVariables, renderPrompt } from "../shared/prompt";
import {
  parsePromptMarkdown,
  promptMarkdownFilename,
  sanitizeDownloadFilename,
  serializePromptMarkdown,
} from "../shared/serialization";
import type {
  AppError,
  AppPing,
  Connection,
  ConnectionSaveInput,
  ImportReport,
  Prompt,
  PromptDraft,
  PromptSaveInput,
  RequestRecord,
  RunRequestInput,
  SettingsUpdateInput,
  Theme,
} from "../shared/types";
import { AppShell } from "./components/AppShell";
import { ComparisonView } from "./components/ComparisonView";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { EmptyState } from "./components/EmptyState";
import { HistoryList } from "./components/HistoryList";
import { Icon } from "./components/Icon";
import { downloadTextFile, JSON_MIME_TYPE, MARKDOWN_MIME_TYPE } from "./components/ImportExportControls";
import { PromptEditor } from "./components/PromptEditor";
import { PromptList } from "./components/PromptList";
import { ResponseViewer } from "./components/ResponseViewer";
import { RunPanel } from "./components/RunPanel";
import { SettingsView } from "./components/SettingsView";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import { useForgeboard } from "./hooks/useForgeboard";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  createLoadingRendererState,
  type LiveRun,
  type RendererState,
} from "./state";

interface BridgeStatus {
  ping: AppPing | null;
  unavailable: boolean;
}

const loadingState = createLoadingRendererState();
const emptyPromptDraft: PromptDraft = {
  title: "",
  description: "",
  body: "",
  tags: [],
  favorite: false,
};

function useBridgeStatus(): BridgeStatus {
  const [ping, setPing] = useState<AppPing | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    const bridge = typeof window === "undefined" ? undefined : window.forgeboard;

    if (!bridge || typeof bridge.ping !== "function") {
      setUnavailable(true);
      return () => {
        mounted = false;
      };
    }

    try {
      void Promise.resolve(bridge.ping()).then(
        (result) => {
          if (mounted && result && typeof result.version === "string") {
            setPing(result);
            setUnavailable(false);
          } else if (mounted) {
            setUnavailable(true);
          }
        },
        () => {
          if (mounted) {
            setUnavailable(true);
          }
        },
      );
    } catch {
      if (mounted) {
        setUnavailable(true);
      }
    }

    return () => {
      mounted = false;
    };
  }, []);

  return { ping, unavailable };
}

function BridgeReadiness({ status }: { status: BridgeStatus }) {
  const message = status.ping
    ? `Ready · version ${status.ping.version}`
    : status.unavailable
      ? "The local bridge is unavailable."
      : "Checking the local bridge…";

  return (
    <p className="bridge-readiness" role="status" aria-live="polite">
      <span
        className={`status-pip ${status.ping ? "is-ready" : status.unavailable ? "is-danger" : "is-pending"}`}
        aria-hidden="true"
      />
      <span>{message}</span>
    </p>
  );
}

function LoadingView({ status }: { status: BridgeStatus }) {
  return (
    <section className="loading-view" aria-labelledby="loading-title">
      <div className="loading-mark" aria-hidden="true">
        <Icon name="layers" size={22} />
      </div>
      <p className="section-kicker">Developer workspace</p>
      <h1 id="loading-title">Make room for better prompts.</h1>
      <p>Opening your local prompt workspace. Nothing leaves this device.</p>
      <BridgeReadiness status={status} />
    </section>
  );
}

function InitializationErrorView({
  status,
  error,
  onRetry,
}: {
  status: BridgeStatus;
  error: AppError;
  onRetry: () => void;
}) {
  return (
    <section className="loading-view error-view" aria-labelledby="error-title" role="alert">
      <div className="loading-mark" aria-hidden="true">
        <Icon name="archive" size={22} />
      </div>
      <p className="section-kicker">Local bridge</p>
      <h1 id="error-title">The workspace could not open.</h1>
      <p>{error.message}</p>
      {error.detail ? <p className="error-detail">{error.detail}</p> : null}
      <div className="boot-actions">
        <button className="button button-primary" type="button" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          <span>Try again</span>
        </button>
      </div>
      <BridgeReadiness status={status} />
    </section>
  );
}

function ActiveRunSummary({ run }: { run: LiveRun | null }) {
  if (!run) {
    return null;
  }

  const statusLabel =
    run.status === "running"
      ? "Streaming"
      : run.status === "success"
        ? "Complete"
        : run.status === "cancelled"
          ? "Cancelled"
          : "Needs attention";

  return (
    <section className="live-run-strip" aria-label="Latest run status">
      <div className="live-run-heading">
        <div className="live-run-label">
          <Icon name="terminal" size={15} />
          <span>Latest run</span>
        </div>
        <span className={`run-status run-status-${run.status}`}>{statusLabel}</span>
      </div>
      <p className="live-run-model">
        {run.model} <span aria-hidden="true">·</span> {run.requestId}
      </p>
      <p className={`live-run-response ${run.response ? "has-response" : ""}`}>
        {run.response || "Waiting for the first response chunk…"}
      </p>
    </section>
  );
}

function promptToDraft(prompt: Prompt): PromptDraft {
  return {
    title: prompt.title,
    description: prompt.description,
    body: prompt.body,
    tags: [...prompt.tags],
    favorite: prompt.favorite,
  };
}

interface PromptLibraryProps {
  state: RendererState;
  draft: PromptDraft;
  variableValues: Record<string, string>;
  promptError: string | null;
  promptNotice: string | null;
  savingPrompt: boolean;
  onDraftChange: (draft: PromptDraft) => void;
  onVariableValuesChange: (values: Record<string, string>) => void;
  onSavePrompt: (draft: PromptDraft) => Promise<void>;
  onCancelPrompt: () => void;
  onCreatePrompt: () => void;
  onSelectPrompt: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
  onSearchChange: (search: string) => void;
  promptSearchRef: RefObject<HTMLInputElement | null>;
  onWorkspaceChange: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  connections: Connection[];
  selectedConnectionId?: string;
  activeRun: LiveRun | null;
  runResult: RequestRecord | null;
  runError: AppError | null;
  runPending: boolean;
  onConnectionChange: (connectionId: string) => void;
  onCreateConnection: () => void;
  onEditConnection: (connection: Connection) => void;
  onRun: (input: RunRequestInput) => Promise<void>;
  onCancelRun: (requestId: string) => Promise<void>;
  onResponseCompare: (request: RequestRecord) => void;
  onRetryRun: () => void;
  onClearRunError: () => void;
}

function PromptLibrary({
  state,
  draft,
  variableValues,
  promptError,
  promptNotice,
  savingPrompt,
  onDraftChange,
  onVariableValuesChange,
  onSavePrompt,
  onCancelPrompt,
  onCreatePrompt,
  onSelectPrompt,
  onToggleFavorite,
  onSearchChange,
  promptSearchRef,
  onWorkspaceChange,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  connections,
  selectedConnectionId,
  activeRun,
  runResult,
  runError,
  runPending,
  onConnectionChange,
  onCreateConnection,
  onEditConnection,
  onRun,
  onCancelRun,
  onResponseCompare,
  onRetryRun,
  onClearRunError,
}: PromptLibraryProps) {
  const prompts = useMemo(
    () => state.document.prompts.filter((prompt) => prompt.workspaceId === state.activeWorkspace.id),
    [state.activeWorkspace.id, state.document.prompts],
  );
  const visibleRun =
    activeRun &&
    activeRun.workspaceId === state.activeWorkspace.id &&
    (state.selectedPromptId
      ? activeRun.promptId === state.selectedPromptId
      : activeRun.promptId === undefined)
      ? activeRun
      : null;

  return (
    <div className="prompt-library-view">
      <div className="library-toolbar">
        <div className="library-toolbar-copy">
          <p className="section-kicker">Prompt library</p>
          <h1>Reusable instructions, close at hand.</h1>
          <p>Search, shape, and save the prompts you reach for most.</p>
        </div>
        <WorkspaceMenu
          activeWorkspaceId={state.activeWorkspace.id}
          onCreateWorkspace={onCreateWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onWorkspaceChange={onWorkspaceChange}
          workspaces={state.document.workspaces}
        />
      </div>

      <div className="library-columns">
        <PromptList
          inputRef={promptSearchRef}
          onCreatePrompt={onCreatePrompt}
          onSearchChange={onSearchChange}
          onSelect={onSelectPrompt}
          onToggleFavorite={onToggleFavorite}
          prompts={prompts}
          search={state.search}
          selectedPromptId={state.selectedPromptId}
        />
        <PromptEditor
          draft={draft}
          error={promptError}
          isNew={!state.selectedPromptId}
          notice={promptNotice}
          onCancel={onCancelPrompt}
          onChange={onDraftChange}
          onSave={onSavePrompt}
          onVariableValuesChange={onVariableValuesChange}
          saving={savingPrompt}
          variableValues={variableValues}
        />
      </div>

      <div className="run-workflow">
        <RunPanel
          activeRun={activeRun}
          connections={connections}
          error={runError}
          isRunning={runPending}
          onCancel={onCancelRun}
          onConnectionChange={onConnectionChange}
          onDismissError={onClearRunError}
          onCreateConnection={onCreateConnection}
          onEditConnection={onEditConnection}
          onRetry={onRetryRun}
          onRun={onRun}
          promptId={state.selectedPromptId}
          promptBody={draft.body}
          selectedConnectionId={selectedConnectionId}
          showVariableFields={false}
          variableValues={variableValues}
          workspaceId={state.activeWorkspace.id}
        />
        {visibleRun || runResult ? (
          <ResponseViewer
            error={runError ?? visibleRun?.error}
            liveText={visibleRun?.response}
            onCompare={onResponseCompare}
            onDismissError={onClearRunError}
            onRetry={onRetryRun}
            record={runResult ?? visibleRun?.record}
            status={runResult ? "completed" : visibleRun?.status === "running" ? "running" : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

interface HistoryViewProps {
  state: RendererState;
  selectedRequestId?: string;
  comparisonIds: string[];
  comparisonRecords: [RequestRecord, RequestRecord] | null;
  onSelectRequest: (request: RequestRecord) => void;
  onComparisonChange: (requestIds: string[]) => void;
  onCompare: (left: RequestRecord, right: RequestRecord) => void;
  onCloseComparison: () => void;
  onResponseCompare: (request: RequestRecord) => void;
}

function HistoryView({
  state,
  selectedRequestId,
  comparisonIds,
  comparisonRecords,
  onSelectRequest,
  onComparisonChange,
  onCompare,
  onCloseComparison,
  onResponseCompare,
}: HistoryViewProps) {
  const requests = useMemo(
    () =>
      state.document.requests.filter(
        (request) => request.workspaceId === state.activeWorkspace.id,
      ),
    [state.activeWorkspace.id, state.document.requests],
  );
  const selectedRequest = requests.find((request) => request.id === selectedRequestId);

  return (
    <div className="history-view">
      <div className="view-intro">
        <p className="section-kicker">Run history</p>
        <h1>A record of your model work.</h1>
        <p>
          {requests.length} {requests.length === 1 ? "run is" : "runs are"} retained in this
          workspace. Review a response, copy it, or select two runs to compare their shape.
        </p>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          description="When you run a prompt, its provider, model, timing, and response will be collected here for a calm review."
          eyebrow="Run history"
          icon="history"
          title="No responses to review yet."
        />
      ) : (
        <div className="history-content">
          <HistoryList
            comparisonIds={comparisonIds}
            onCompare={onCompare}
            onComparisonChange={onComparisonChange}
            onSelect={onSelectRequest}
            requests={requests}
            selectedRequestId={selectedRequestId}
          />
          {selectedRequest ? (
            <ResponseViewer
              onCompare={onResponseCompare}
              record={selectedRequest}
            />
          ) : (
            <div className="history-selection-empty" role="status">
              <Icon name="history" size={19} />
              <p>Choose a run above to inspect its prompt and response.</p>
            </div>
          )}
        </div>
      )}

      {comparisonRecords ? (
        <ComparisonView
          left={comparisonRecords[0]}
          onClose={onCloseComparison}
          right={comparisonRecords[1]}
        />
      ) : null}
    </div>
  );
}

interface ActiveViewProps {
  state: RendererState;
  promptDraft: PromptDraft;
  variableValues: Record<string, string>;
  promptError: string | null;
  promptNotice: string | null;
  savingPrompt: boolean;
  onCreatePrompt: () => void;
  onSelectPrompt: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
  onSearchChange: (search: string) => void;
  onDraftChange: (draft: PromptDraft) => void;
  onVariableValuesChange: (values: Record<string, string>) => void;
  onSavePrompt: (draft: PromptDraft) => Promise<void>;
  onCancelPrompt: () => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  promptSearchRef: RefObject<HTMLInputElement | null>;
  connections: Connection[];
  selectedConnectionId?: string;
  activeRun: LiveRun | null;
  runResult: RequestRecord | null;
  runError: AppError | null;
  runPending: boolean;
  onConnectionChange: (connectionId: string) => void;
  onCreateConnection: () => void;
  onEditConnection: (connection: Connection) => void;
  onRun: (input: RunRequestInput) => Promise<void>;
  onCancelRun: (requestId: string) => Promise<void>;
  onResponseCompare: (request: RequestRecord) => void;
  onRetryRun: () => void;
  onClearRunError: () => void;
  comparisonIds: string[];
  comparisonRecords: [RequestRecord, RequestRecord] | null;
  onSelectRequest: (request: RequestRecord) => void;
  onComparisonChange: (requestIds: string[]) => void;
  onCompare: (left: RequestRecord, right: RequestRecord) => void;
  onCloseComparison: () => void;
  onSettingsUpdate: (input: SettingsUpdateInput) => void | Promise<void>;
  onExportWorkspace: () => Promise<string>;
  onExportPrompt: (() => Promise<string>) | null;
  onImportJson: (contents: string) => Promise<ImportReport>;
  onImportMarkdown: (contents: string, filename: string) => Promise<string>;
  onDeleteConnection: (connectionId: string) => void | Promise<void>;
  onThemeChange: (theme: Theme) => void;
}

function ActiveView({
  state,
  promptDraft,
  variableValues,
  promptError,
  promptNotice,
  savingPrompt,
  onCreatePrompt,
  onSelectPrompt,
  onToggleFavorite,
  onSearchChange,
  onDraftChange,
  onVariableValuesChange,
  onSavePrompt,
  onCancelPrompt,
  onWorkspaceChange,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  promptSearchRef,
  connections,
  selectedConnectionId,
  activeRun,
  runResult,
  runError,
  runPending,
  onConnectionChange,
  onCreateConnection,
  onEditConnection,
  onRun,
  onCancelRun,
  onResponseCompare,
  onRetryRun,
  onClearRunError,
  comparisonIds,
  comparisonRecords,
  onSelectRequest,
  onComparisonChange,
  onCompare,
  onCloseComparison,
  onSettingsUpdate,
  onExportWorkspace,
  onExportPrompt,
  onImportJson,
  onImportMarkdown,
  onDeleteConnection,
  onThemeChange,
}: ActiveViewProps) {
  return (
    <>
      <ActiveRunSummary run={state.activeRun} />
      {state.view === "prompts" ? (
        <PromptLibrary
          activeRun={activeRun}
          connections={connections}
          draft={promptDraft}
          onCancelPrompt={onCancelPrompt}
          onCancelRun={onCancelRun}
          onConnectionChange={onConnectionChange}
          onCreateConnection={onCreateConnection}
          onCreatePrompt={onCreatePrompt}
          onCreateWorkspace={onCreateWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          onDraftChange={onDraftChange}
          onEditConnection={onEditConnection}
          onRenameWorkspace={onRenameWorkspace}
          onResponseCompare={onResponseCompare}
          onRetryRun={onRetryRun}
          onClearRunError={onClearRunError}
          onRun={onRun}
          onSavePrompt={onSavePrompt}
          onSearchChange={onSearchChange}
          onSelectPrompt={onSelectPrompt}
          onToggleFavorite={onToggleFavorite}
          onVariableValuesChange={onVariableValuesChange}
          onWorkspaceChange={onWorkspaceChange}
          promptError={promptError}
          promptNotice={promptNotice}
          promptSearchRef={promptSearchRef}
          runError={runError}
          runPending={runPending}
          runResult={runResult}
          savingPrompt={savingPrompt}
          selectedConnectionId={selectedConnectionId}
          state={state}
          variableValues={variableValues}
        />
      ) : state.view === "history" ? (
        <HistoryView
          comparisonIds={comparisonIds}
          comparisonRecords={comparisonRecords}
          onCloseComparison={onCloseComparison}
          onCompare={onCompare}
          onComparisonChange={onComparisonChange}
          onResponseCompare={onResponseCompare}
          onSelectRequest={onSelectRequest}
          selectedRequestId={state.selectedRequestId}
          state={state}
        />
      ) : (
        <SettingsView
          onCreateConnection={onCreateConnection}
          onDeleteConnection={onDeleteConnection}
          onEditConnection={onEditConnection}
          onExportPrompt={onExportPrompt}
          onExportWorkspace={onExportWorkspace}
          onImportJson={onImportJson}
          onImportMarkdown={onImportMarkdown}
          onSettingsUpdate={onSettingsUpdate}
          onThemeChange={onThemeChange}
          state={state}
        />
      )}
    </>
  );
}

function getBridge(): NonNullable<Window["forgeboard"]> {
  const bridge = typeof window === "undefined" ? undefined : window.forgeboard;
  if (!bridge) {
    throw new Error("The local Forgeboard bridge is unavailable.");
  }
  return bridge;
}

function App() {
  const {
    state,
    loading,
    error,
    refresh,
    navigate,
    selectPrompt,
    selectRequest,
    setSearch,
    setTheme,
  } = useForgeboard();
  const bridgeStatus = useBridgeStatus();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState<PromptDraft>(emptyPromptDraft);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const [connectionDialog, setConnectionDialog] = useState<
    { mode: "create" } | { mode: "edit"; connection: Connection } | null
  >(null);
  const [runResult, setRunResult] = useState<RequestRecord | null>(null);
  const [runError, setRunError] = useState<AppError | null>(null);
  const [runPending, setRunPending] = useState(false);
  const [historyComparisonIds, setHistoryComparisonIds] = useState<string[]>([]);
  const [comparisonRecords, setComparisonRecords] = useState<
    [RequestRecord, RequestRecord] | null
  >(null);
  const promptSearchRef = useRef<HTMLInputElement>(null);
  const connectionDialogTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedPromptIdRef = useRef<string | undefined>(undefined);
  const valuesByPromptRef = useRef<Record<string, Record<string, string>>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? "system";
  }, [state?.theme]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const availableIds = new Set(state.document.connections.map((connection) => connection.id));
    setSelectedConnectionId((current) =>
      current && availableIds.has(current) ? current : undefined,
    );
  }, [state?.document.connections]);

  useEffect(() => {
    setHistoryComparisonIds((current) => {
      if (!state) {
        return current;
      }
      const availableIds = new Set(
        state.document.requests
          .filter((request) => request.workspaceId === state.activeWorkspace.id)
          .map((request) => request.id),
      );
      const next = current.filter((id) => availableIds.has(id)).slice(-2);
      return next.length === current.length ? current : next;
    });
    setComparisonRecords((current) => {
      if (!current) {
        return null;
      }
      return state?.document.requests.some(
        (request) => request.id === current[0].id,
      ) && state.document.requests.some((request) => request.id === current[1].id)
        ? current
        : null;
    });
  }, [state?.activeWorkspace.id, state?.document.requests]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const nextSelectedId = state.selectedPromptId;
    if (nextSelectedId === selectedPromptIdRef.current) {
      return;
    }
    selectedPromptIdRef.current = nextSelectedId;

    if (!nextSelectedId) {
      setPromptDraft({ ...emptyPromptDraft, tags: [] });
      setVariableValues({});
      setPromptError(null);
      setPromptNotice(null);
      return;
    }

    const selectedPrompt = state.document.prompts.find(
      (prompt) => prompt.id === nextSelectedId && prompt.workspaceId === state.activeWorkspace.id,
    );
    if (!selectedPrompt) {
      return;
    }

    setPromptDraft(promptToDraft(selectedPrompt));
    setVariableValues({ ...(valuesByPromptRef.current[nextSelectedId] ?? {}) });
    setPromptError(null);
    setPromptNotice(null);
  }, [state]);

  const activeConnectionId = useMemo(() => {
    if (!state) {
      return undefined;
    }
    const connections = state.document.connections;
    if (selectedConnectionId && connections.some((item) => item.id === selectedConnectionId)) {
      return selectedConnectionId;
    }
    const defaultId = state.document.settings.defaultConnectionId;
    if (defaultId && connections.some((item) => item.id === defaultId)) {
      return defaultId;
    }
    return connections[0]?.id;
  }, [selectedConnectionId, state]);

  const handleCreatePrompt = useCallback(() => {
    selectedPromptIdRef.current = undefined;
    setPromptDraft({ ...emptyPromptDraft, tags: [] });
    setVariableValues({});
    setPromptError(null);
    setPromptNotice(null);
    setRunResult(null);
    setRunError(null);
    setSearch("");
    navigate("prompts");
    selectPrompt(undefined);
  }, [navigate, selectPrompt, setSearch]);

  const handleSelectPrompt = useCallback(
    (prompt: Prompt) => {
      if (!state || prompt.workspaceId !== state.activeWorkspace.id) {
        return;
      }
      selectedPromptIdRef.current = prompt.id;
      setPromptDraft(promptToDraft(prompt));
      setVariableValues({ ...(valuesByPromptRef.current[prompt.id] ?? {}) });
      setPromptError(null);
      setPromptNotice(null);
      setRunResult(null);
      setRunError(null);
      selectPrompt(prompt.id);
    },
    [selectPrompt, state],
  );

  const handleCancelPrompt = useCallback(() => {
    if (!state) {
      return;
    }
    const selectedPrompt = state.selectedPromptId
      ? state.document.prompts.find((prompt) => prompt.id === state.selectedPromptId)
      : undefined;
    if (selectedPrompt) {
      setPromptDraft(promptToDraft(selectedPrompt));
      setVariableValues({ ...(valuesByPromptRef.current[selectedPrompt.id] ?? {}) });
    } else {
      setPromptDraft({ ...emptyPromptDraft, tags: [] });
      setVariableValues({});
    }
    setPromptError(null);
    setPromptNotice(null);
  }, [state]);

  const handleDraftChange = useCallback((nextDraft: PromptDraft) => {
    setPromptDraft(nextDraft);
    setPromptError(null);
    setPromptNotice(null);
  }, []);

  const handleVariableValuesChange = useCallback(
    (nextValues: Record<string, string>) => {
      setVariableValues(nextValues);
      const selectedId = selectedPromptIdRef.current;
      if (selectedId) {
        valuesByPromptRef.current[selectedId] = { ...nextValues };
      }
    },
    [],
  );

  const handleSavePrompt = useCallback(
    async (draft: PromptDraft): Promise<void> => {
      if (!state) {
        return;
      }
      const missingVariables = extractVariables(draft.body).filter(
        (variable) => !(variableValues[variable] ?? "").trim(),
      );
      if (draft.title.trim().length === 0 || missingVariables.length > 0) {
        setPromptError(
          draft.title.trim().length === 0
            ? "Add a title before saving this prompt."
            : `Fill in the required variables: ${missingVariables.join(", ")}.`,
        );
        return;
      }

      setSavingPrompt(true);
      setPromptError(null);
      setPromptNotice(null);
      try {
        const input: PromptSaveInput = {
          workspaceId: state.activeWorkspace.id,
          title: draft.title,
          description: draft.description,
          body: draft.body,
          tags: draft.tags,
          favorite: draft.favorite,
          ...(state.selectedPromptId ? { id: state.selectedPromptId } : {}),
        };
        const savedPrompt = await getBridge().savePrompt(input);
        if (savedPrompt?.id) {
          valuesByPromptRef.current[savedPrompt.id] = { ...variableValues };
          selectPrompt(savedPrompt.id);
        }
        await refresh();
        setPromptNotice("Prompt saved locally.");
      } catch (cause) {
        const appError = normalizeAppError(cause);
        setPromptError(appError.message);
        throw new Error(appError.message);
      } finally {
        setSavingPrompt(false);
      }
    },
    [refresh, selectPrompt, state, variableValues],
  );

  const handleToggleFavorite = useCallback(
    async (prompt: Prompt) => {
      setPromptError(null);
      try {
        await getBridge().savePrompt({
          id: prompt.id,
          workspaceId: prompt.workspaceId,
          title: prompt.title,
          description: prompt.description,
          body: prompt.body,
          tags: prompt.tags,
          favorite: !prompt.favorite,
        });
        if (selectedPromptIdRef.current === prompt.id) {
          setPromptDraft((current) => ({ ...current, favorite: !prompt.favorite }));
        }
        await refresh();
      } catch (cause) {
        setPromptError(normalizeAppError(cause).message);
      }
    },
    [refresh],
  );

  const handleConnectionChange = useCallback((connectionId: string): void => {
    setSelectedConnectionId(connectionId || undefined);
  }, []);

  const handleCreateConnection = useCallback((): void => {
    setConnectionDialog({ mode: "create" });
  }, []);

  const handleEditConnection = useCallback((connection: Connection): void => {
    setConnectionDialog({ mode: "edit", connection });
  }, []);

  const handleConnectionDialogClose = useCallback((): void => {
    setConnectionDialog(null);
  }, []);

  const handleConnectionSave = useCallback(
    async (input: ConnectionSaveInput): Promise<Connection | undefined> => {
      const savedConnection = await getBridge().saveConnection(input);
      await refresh();
      if (savedConnection?.id) {
        setSelectedConnectionId(savedConnection.id);
      } else if (input.id) {
        setSelectedConnectionId(input.id);
      }
      return savedConnection;
    },
    [refresh],
  );

  const handleWorkspaceChange = useCallback(
    (workspaceId: string) => {
      if (!state || workspaceId === state.activeWorkspace.id) {
        return;
      }
      setWorkspaceError(null);
      setSearch("");
      selectedPromptIdRef.current = undefined;
      setPromptDraft({ ...emptyPromptDraft, tags: [] });
      setVariableValues({});
      setRunResult(null);
      setRunError(null);
      selectPrompt(undefined);
      void (async () => {
        try {
          await getBridge().setActiveWorkspace(workspaceId);
          await refresh();
        } catch (cause) {
          setWorkspaceError(normalizeAppError(cause).message);
        }
      })();
    },
    [refresh, selectPrompt, setSearch, state],
  );

  const handleCreateWorkspace = useCallback(
    async (name: string): Promise<void> => {
      setWorkspaceError(null);
      setSearch("");
      try {
        const created = await getBridge().createWorkspace(name);
        if (created?.id && state && created.id !== state.activeWorkspace.id) {
          await getBridge().setActiveWorkspace(created.id);
        }
        await refresh();
      } catch (cause) {
        setWorkspaceError(normalizeAppError(cause).message);
        throw new Error(normalizeAppError(cause).message);
      }
    },
    [refresh, setSearch, state],
  );

  const handleRenameWorkspace = useCallback(
    async (workspaceId: string, name: string): Promise<void> => {
      setWorkspaceError(null);
      try {
        await getBridge().renameWorkspace(workspaceId, name);
        await refresh();
      } catch (cause) {
        const appError = normalizeAppError(cause);
        setWorkspaceError(appError.message);
        throw new Error(appError.message);
      }
    },
    [refresh],
  );

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      setWorkspaceError(null);
      try {
        const nextActive = await getBridge().deleteWorkspace(workspaceId);
        const fallbackWorkspace =
          nextActive ?? state?.document.workspaces.find((workspace) => workspace.id !== workspaceId);
        if (
          state &&
          workspaceId === state.activeWorkspace.id &&
          fallbackWorkspace &&
          fallbackWorkspace.id !== workspaceId
        ) {
          await getBridge().setActiveWorkspace(fallbackWorkspace.id);
          selectedPromptIdRef.current = undefined;
          setPromptDraft({ ...emptyPromptDraft, tags: [] });
          setVariableValues({});
          setRunResult(null);
          setRunError(null);
          selectPrompt(undefined);
        }
        await refresh();
      } catch (cause) {
        const appError = normalizeAppError(cause);
        setWorkspaceError(appError.message);
        throw new Error(appError.message);
      }
    },
    [refresh, selectPrompt, state],
  );

  const handleSelectRequest = useCallback(
    (request: RequestRecord): void => {
      if (!state || request.workspaceId !== state.activeWorkspace.id) {
        return;
      }
      selectRequest(request.id);
    },
    [selectRequest, state],
  );

  const handleComparisonChange = useCallback((requestIds: string[]): void => {
    setHistoryComparisonIds(requestIds.slice(-2));
    if (requestIds.length < 2) {
      setComparisonRecords(null);
    }
  }, []);

  const handleCompare = useCallback(
    (left: RequestRecord, right: RequestRecord): void => {
      if (left.workspaceId !== right.workspaceId) {
        return;
      }
      setHistoryComparisonIds([left.id, right.id]);
      setComparisonRecords([left, right]);
    },
    [],
  );

  const handleCloseComparison = useCallback((): void => {
    setComparisonRecords(null);
    setHistoryComparisonIds([]);
  }, []);

  const handleResponseCompare = useCallback(
    (request: RequestRecord): void => {
      const nextIds = [...historyComparisonIds.filter((id) => id !== request.id), request.id].slice(-2);
      setHistoryComparisonIds(nextIds);
      if (nextIds.length === 2 && state) {
        const left = state.document.requests.find((candidate) => candidate.id === nextIds[0]);
        const right = state.document.requests.find((candidate) => candidate.id === nextIds[1]);
        if (left && right) {
          setComparisonRecords([left, right]);
        }
      }
    },
    [historyComparisonIds, state],
  );

  const handleRunRequest = useCallback(
    async (input: RunRequestInput): Promise<void> => {
      if (!state) {
        return;
      }

      setRunResult(null);
      setRunError(null);
      setRunPending(true);
      try {
        const record = await getBridge().runRequest({
          ...input,
          workspaceId: state.activeWorkspace.id,
        });
        if (record) {
          setRunResult(record);
        }
        await refresh();
      } catch (cause) {
        const appError = normalizeAppError(cause);
        if (appError.code !== "CANCELLED") {
          setRunError(appError);
        }
        await refresh();
      } finally {
        setRunPending(false);
      }
    },
    [refresh, state],
  );

  const handleRetryRun = useCallback((): void => {
    if (!state || runPending || state.activeRun?.status === "running") {
      return;
    }
    const rendered = renderPrompt(promptDraft.body, variableValues);
    const connection = state.document.connections.find(
      (candidate) => candidate.id === activeConnectionId,
    );
    if (!connection || promptDraft.body.trim().length === 0 || rendered.missing.length > 0) {
      return;
    }
    void handleRunRequest({
      ...(state.selectedPromptId ? { promptId: state.selectedPromptId } : {}),
      connectionId: connection.id,
      renderedPrompt: rendered.text,
      stream: true,
      timeoutMs: 60_000,
    });
  }, [
    activeConnectionId,
    handleRunRequest,
    promptDraft.body,
    runPending,
    state,
    variableValues,
  ]);

  const handleCancelRun = useCallback(async (requestId: string): Promise<void> => {
    setRunError(null);
    try {
      await getBridge().cancelRequest(requestId);
    } catch (cause) {
      setRunError(normalizeAppError(cause));
    }
  }, []);

  const handleKeyboardRun = useCallback(() => {
    if (!state || runPending || state.activeRun?.status === "running") {
      return;
    }
    const rendered = renderPrompt(promptDraft.body, variableValues);
    if (promptDraft.title.trim().length === 0) {
      setPromptError("Add a title before running this prompt.");
      return;
    }
    if (rendered.missing.length > 0) {
      setPromptError(`Fill in the required variables: ${rendered.missing.join(", ")}.`);
      return;
    }
    const connection =
      state.document.connections.find((candidate) => candidate.id === selectedConnectionId) ??
      state.document.connections.find(
        (candidate) => candidate.id === state.document.settings.defaultConnectionId,
      ) ??
      state.document.connections[0];
    if (!connection) {
      setPromptError("Choose or add a model connection before running this prompt.");
      return;
    }
    setPromptError(null);
    void handleRunRequest({
      ...(state.selectedPromptId ? { promptId: state.selectedPromptId } : {}),
      connectionId: connection.id,
      renderedPrompt: rendered.text,
      stream: true,
      timeoutMs: 60_000,
    });
  }, [handleRunRequest, promptDraft.body, promptDraft.title, runPending, selectedConnectionId, state, variableValues]);

  const handleFocusSearch = useCallback(() => {
    const input = promptSearchRef.current ?? document.getElementById("prompt-search");
    if (input instanceof HTMLInputElement) {
      input.focus();
      return;
    }
    navigate("prompts");
    window.requestAnimationFrame(() => document.getElementById("prompt-search")?.focus());
  }, [navigate]);

  useKeyboardShortcuts({
    onFocusSearch: handleFocusSearch,
    onNewPrompt: handleCreatePrompt,
    onRun: handleKeyboardRun,
  });

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      // The choice is applied immediately so the surface never feels laggy, and
      // it is then persisted through the bridge and re-read from the store.
      setTheme(theme);
      void (async () => {
        try {
          await getBridge().updateSettings({ theme });
          await refresh();
        } catch (cause) {
          setWorkspaceError(normalizeAppError(cause).message);
        }
      })();
    },
    [refresh, setTheme],
  );

  const handleSettingsUpdate = useCallback(
    async (input: SettingsUpdateInput): Promise<void> => {
      try {
        await getBridge().updateSettings(input);
        await refresh();
      } catch (cause) {
        throw new AppErrorException(normalizeAppError(cause));
      }
    },
    [refresh],
  );

  const handleDeleteConnection = useCallback(
    async (connectionId: string): Promise<void> => {
      try {
        await getBridge().deleteConnection(connectionId);
        await refresh();
      } catch (cause) {
        throw new AppErrorException(normalizeAppError(cause));
      }
    },
    [refresh],
  );

  const handleExportWorkspace = useCallback(async (): Promise<string> => {
    const data = await getBridge().exportData();
    if (!data || typeof data.contents !== "string") {
      throw new AppErrorException(
        createAppError("STORAGE", "The workspace snapshot could not be prepared."),
      );
    }
    downloadTextFile(data.filename, data.contents, JSON_MIME_TYPE);
    return sanitizeDownloadFilename(data.filename);
  }, []);

  const handleExportPromptMarkdown = useCallback(async (): Promise<string> => {
    if (!state) {
      throw new AppErrorException(
        createAppError("STORAGE", "The workspace is still loading."),
      );
    }
    const prompt =
      state.document.prompts.find(
        (candidate) =>
          candidate.id === state.selectedPromptId &&
          candidate.workspaceId === state.activeWorkspace.id,
      ) ?? null;
    if (!prompt) {
      throw new AppErrorException(
        createAppError("VALIDATION", "Select a prompt in the library before exporting it."),
      );
    }
    const filename = promptMarkdownFilename(prompt);
    downloadTextFile(filename, serializePromptMarkdown(prompt), MARKDOWN_MIME_TYPE);
    return filename;
  }, [state]);

  const handleImportJson = useCallback(
    async (contents: string): Promise<ImportReport> => {
      try {
        const report = await getBridge().importData(contents);
        await refresh();
        return report;
      } catch (cause) {
        throw new AppErrorException(normalizeAppError(cause));
      }
    },
    [refresh],
  );

  const handleImportMarkdown = useCallback(
    async (contents: string, filename: string): Promise<string> => {
      if (!state) {
        throw new AppErrorException(
          createAppError("IMPORT", "The workspace is still loading."),
        );
      }
      try {
        // Parsing happens in the renderer with the shared, side-effect-free
        // reader so a malformed file never reaches the local store.
        const draft = parsePromptMarkdown(contents);
        const saved = await getBridge().savePrompt({
          ...draft,
          workspaceId: state.activeWorkspace.id,
        });
        await refresh();
        if (saved?.id) {
          selectPrompt(saved.id);
        }
        return saved?.title ?? draft.title;
      } catch (cause) {
        // Naming the file keeps a rejected import actionable without exposing
        // anything beyond what the picker already showed.
        const safeName = redactSecrets(
          sanitizeDownloadFilename(filename, "the selected file"),
        );
        const appError = normalizeAppError(cause);
        throw new AppErrorException({
          ...appError,
          detail: appError.detail ? `${safeName}: ${appError.detail}` : safeName,
        });
      }
    },
    [refresh, selectPrompt, state],
  );

  const handleClearRunError = useCallback((): void => {
    setRunError(null);
  }, []);

  const displayState = state ?? loadingState;
  const initializationError = state ? error?.message ?? workspaceError : null;

  return (
    <>
      <AppShell
      bridgePing={bridgeStatus.ping}
      bridgeUnavailable={bridgeStatus.unavailable}
      initializationError={
        initializationError ? (
          <div className="initialization-error-copy">
            <strong>Some workspace details could not refresh.</strong>
            <p>{initializationError}</p>
            <button className="text-button" type="button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : null
      }
      onCreatePrompt={handleCreatePrompt}
      onRefresh={() => void refresh()}
      onThemeChange={handleThemeChange}
      onViewChange={navigate}
      onWorkspaceChange={handleWorkspaceChange}
      loading={loading || !state}
      refreshing={loading}
      state={displayState}
    >
      {state ? (
        <ActiveView
          activeRun={state.activeRun}
          comparisonIds={historyComparisonIds}
          comparisonRecords={comparisonRecords}
          connections={state.document.connections}
          onCancelPrompt={handleCancelPrompt}
          onCancelRun={handleCancelRun}
          onCloseComparison={handleCloseComparison}
          onCompare={handleCompare}
          onComparisonChange={handleComparisonChange}
          onConnectionChange={handleConnectionChange}
          onCreateConnection={handleCreateConnection}
          onCreatePrompt={handleCreatePrompt}
          onCreateWorkspace={handleCreateWorkspace}
          onDeleteConnection={handleDeleteConnection}
          onDeleteWorkspace={handleDeleteWorkspace}
          onDraftChange={handleDraftChange}
          onEditConnection={handleEditConnection}
          onExportPrompt={state.selectedPromptId ? handleExportPromptMarkdown : null}
          onExportWorkspace={handleExportWorkspace}
          onImportJson={handleImportJson}
          onImportMarkdown={handleImportMarkdown}
          onRenameWorkspace={handleRenameWorkspace}
          onResponseCompare={handleResponseCompare}
          onRetryRun={handleRetryRun}
          onClearRunError={handleClearRunError}
          onRun={handleRunRequest}
          onSavePrompt={handleSavePrompt}
          onSearchChange={setSearch}
          onSelectPrompt={handleSelectPrompt}
          onSelectRequest={handleSelectRequest}
          onSettingsUpdate={handleSettingsUpdate}
          onThemeChange={handleThemeChange}
          onToggleFavorite={handleToggleFavorite}
          onVariableValuesChange={handleVariableValuesChange}
          onWorkspaceChange={handleWorkspaceChange}
          promptDraft={promptDraft}
          promptError={promptError}
          promptNotice={promptNotice}
          promptSearchRef={promptSearchRef}
          runError={runError}
          runPending={runPending}
          runResult={runResult}
          savingPrompt={savingPrompt}
          selectedConnectionId={activeConnectionId}
          state={state}
          variableValues={variableValues}
        />
      ) : loading ? (
        <LoadingView status={bridgeStatus} />
      ) : (
        <InitializationErrorView
          error={error ?? normalizeAppError(new Error("The local workspace is unavailable."))}
          onRetry={() => void refresh()}
          status={bridgeStatus}
        />
      )}
      </AppShell>
      {connectionDialog ? (
        <ConnectionDialog
          connection={connectionDialog.mode === "edit" ? connectionDialog.connection : null}
          credentialsAvailable={state?.credentialsAvailable ?? true}
          onClose={handleConnectionDialogClose}
          onSave={handleConnectionSave}
          open
          triggerRef={connectionDialogTriggerRef}
        />
      ) : null}
    </>
  );
}

export default App;
