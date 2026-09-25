import { useCallback, useEffect, useState } from "react";
import { normalizeAppError } from "../shared/errors";
import type { AppError, AppPing, Theme } from "../shared/types";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { Icon } from "./components/Icon";
import { useForgeboard } from "./hooks/useForgeboard";
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

function PromptOverview({
  state,
  onCreatePrompt,
}: {
  state: RendererState;
  onCreatePrompt: () => void;
}) {
  const prompts = state.document.prompts.filter(
    (prompt) => prompt.workspaceId === state.activeWorkspace.id,
  );

  if (prompts.length === 0) {
    return (
      <EmptyState
        actionLabel="Create your first prompt"
        description="Keep the instructions you reach for most close at hand. Your first prompt will live in this workspace and stay on this device."
        eyebrow="Prompt library"
        icon="spark"
        onAction={onCreatePrompt}
        title="Start with a reusable instruction."
      />
    );
  }

  return (
    <section className="view-panel" aria-labelledby="prompt-overview-title">
      <div className="view-intro">
        <p className="section-kicker">Prompt library</p>
        <h1 id="prompt-overview-title">Reusable instructions, close at hand.</h1>
        <p>
          Your workspace holds {prompts.length} {prompts.length === 1 ? "prompt" : "prompts"}. The
          editing surface is the next step in this workbench.
        </p>
      </div>
      <div className="library-ledger" aria-label="Prompt library summary">
        <div>
          <span className="ledger-value">{prompts.length}</span>
          <span className="ledger-label">saved prompts</span>
        </div>
        <div>
          <span className="ledger-value">{prompts.filter((prompt) => prompt.favorite).length}</span>
          <span className="ledger-label">favorites</span>
        </div>
        <div>
          <span className="ledger-value">{new Set(prompts.flatMap((prompt) => prompt.tags)).size}</span>
          <span className="ledger-label">tags in use</span>
        </div>
      </div>
      <div className="quiet-next-step">
        <Icon name="spark" size={17} />
        <span>Prompt editing and filtering will land here without changing your local data.</span>
      </div>
    </section>
  );
}

function HistoryOverview({ state }: { state: RendererState }) {
  const requests = state.document.requests.filter(
    (request) => request.workspaceId === state.activeWorkspace.id,
  );

  if (requests.length === 0) {
    return (
      <EmptyState
        description="When you run a prompt, its provider, model, timing, and response will be collected here for a calm review."
        eyebrow="Run history"
        icon="history"
        title="No responses to review yet."
      />
    );
  }

  return (
    <section className="view-panel" aria-labelledby="history-overview-title">
      <div className="view-intro">
        <p className="section-kicker">Run history</p>
        <h1 id="history-overview-title">A record of your model work.</h1>
        <p>
          {requests.length} {requests.length === 1 ? "run is" : "runs are"} retained in this
          workspace. Detailed history and comparison tools are next.
        </p>
      </div>
      <div className="quiet-next-step">
        <Icon name="history" size={17} />
        <span>Open a run from the future history view to compare responses side by side.</span>
      </div>
    </section>
  );
}

function SettingsOverview() {
  return (
    <EmptyState
      description="Theme controls are available in the top bar. Import, export, and preference controls will arrive with the transfer workflow."
      eyebrow="Preferences"
      icon="settings"
      title="Settings are being prepared."
    />
  );
}

function ActiveView({
  state,
  onCreatePrompt,
}: {
  state: RendererState;
  onCreatePrompt: () => void;
}) {
  return (
    <>
      <ActiveRunSummary run={state.activeRun} />
      {state.view === "prompts" ? (
        <PromptOverview onCreatePrompt={onCreatePrompt} state={state} />
      ) : state.view === "history" ? (
        <HistoryOverview state={state} />
      ) : (
        <SettingsOverview />
      )}
    </>
  );
}

function App() {
  const {
    state,
    loading,
    error,
    refresh,
    navigate,
    selectPrompt,
    setTheme,
  } = useForgeboard();
  const bridgeStatus = useBridgeStatus();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? "system";
  }, [state?.theme]);

  const handleCreatePrompt = useCallback(() => {
    navigate("prompts");
    selectPrompt(undefined);
  }, [navigate, selectPrompt]);

  const handleWorkspaceChange = useCallback(
    (workspaceId: string) => {
      if (!state || workspaceId === state.activeWorkspace.id) {
        return;
      }
      setWorkspaceError(null);
      void (async () => {
        try {
          const bridge = typeof window === "undefined" ? undefined : window.forgeboard;
          if (!bridge || typeof bridge.setActiveWorkspace !== "function") {
            throw new Error("The local Forgeboard bridge is unavailable.");
          }
          await bridge.setActiveWorkspace(workspaceId);
          await refresh();
        } catch (cause) {
          setWorkspaceError(normalizeAppError(cause).message);
        }
      })();
    },
    [refresh, state],
  );

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      setTheme(theme);
    },
    [setTheme],
  );

  const displayState = state ?? loadingState;
  const initializationError = state ? error?.message ?? workspaceError : null;

  return (
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
        <ActiveView onCreatePrompt={handleCreatePrompt} state={state} />
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
  );
}

export default App;
