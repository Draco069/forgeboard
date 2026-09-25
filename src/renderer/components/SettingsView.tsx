import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeAppError } from "../../shared/errors";
import type {
  Connection,
  ImportReport,
  ProviderKind,
  Settings,
  SettingsUpdateInput,
  Theme,
} from "../../shared/types";
import type { RendererState } from "../state";
import { Icon, type IconName } from "./Icon";
import { ImportExportControls } from "./ImportExportControls";

const themeOptions: Array<{ value: Theme; label: string; icon: IconName }> = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

const providerLabels: Record<ProviderKind, string> = {
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible",
};

export interface SettingsViewProps {
  state: RendererState;
  onThemeChange?: (theme: Theme) => void | Promise<void>;
  onSettingsUpdate?: (input: SettingsUpdateInput) => void | Promise<void>;
  onCreateConnection?: () => void;
  onEditConnection?: (connection: Connection) => void;
  onDeleteConnection?: (connectionId: string) => void | Promise<void>;
  onExportWorkspace: () => string | Promise<string>;
  onExportPrompt?: (() => string | Promise<string>) | null;
  onImportJson: (contents: string) => Promise<ImportReport>;
  onImportMarkdown: (contents: string, filename: string) => Promise<string>;
}

function providerLabel(connection: Connection): string {
  return providerLabels[connection.provider] ?? connection.provider;
}

function describeSafeError(cause: unknown): string {
  const error = normalizeAppError(cause);
  return error.detail ? `${error.message} ${error.detail}` : error.message;
}

export function SettingsView({
  state,
  onThemeChange,
  onSettingsUpdate,
  onCreateConnection,
  onEditConnection,
  onDeleteConnection,
  onExportWorkspace,
  onExportPrompt,
  onImportJson,
  onImportMarkdown,
}: SettingsViewProps) {
  const settings: Settings = state.document.settings;
  const connections = state.document.connections;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Ref callbacks keep a live element per connection. A React synthetic event
  // cannot be stored because `currentTarget` is cleared after dispatch.
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  const connectionsPanelRef = useRef<HTMLElement>(null);
  const appearanceTitleId = useId();
  const connectionTitleId = useId();
  const privacyTitleId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const pendingDelete = useMemo(
    () => connections.find((connection) => connection.id === pendingDeleteId) ?? null,
    [connections, pendingDeleteId],
  );
  const retainedRuns = useMemo(
    () =>
      pendingDelete
        ? state.document.requests.filter(
            (request) => request.connectionId === pendingDelete.id,
          ).length
        : 0,
    [pendingDelete, state.document.requests],
  );

  useEffect(() => {
    if (!pendingDelete) {
      return;
    }
    window.requestAnimationFrame(() => confirmDeleteRef.current?.focus());
  }, [pendingDelete]);

  useEffect(() => {
    if (!pendingDelete) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || deleting) {
        return;
      }
      event.preventDefault();
      setPendingDeleteId(null);
      setDialogError(null);
      restoreDeleteTriggerFocus(pendingDelete.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, pendingDelete]);

  const runSettingsAction = async (
    successMessage: string,
    action: () => void | Promise<void>,
  ): Promise<boolean> => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      return true;
    } catch (cause) {
      setError(describeSafeError(cause));
      return false;
    }
  };

  const handleThemeSelect = (theme: Theme): void => {
    if (theme === settings.theme) {
      return;
    }
    void runSettingsAction(`Color theme set to ${theme}.`, async () => {
      // Persisting through the bridge keeps one source of truth, so the stored
      // theme and the applied theme can never drift apart.
      if (onSettingsUpdate) {
        await onSettingsUpdate({ theme });
        return;
      }
      await onThemeChange?.(theme);
    });
  };

  const handleDefaultConnectionChange = (connectionId: string): void => {
    void runSettingsAction(
      connectionId
        ? "Default model connection updated."
        : "Default model connection cleared.",
      async () => {
        await onSettingsUpdate?.({ defaultConnectionId: connectionId });
      },
    );
  };

  const restoreDeleteTriggerFocus = (connectionId: string | null): void => {
    window.requestAnimationFrame(() => {
      const trigger = connectionId
        ? deleteButtonRefs.current.get(connectionId)
        : undefined;
      (trigger ?? connectionsPanelRef.current)?.focus();
    });
  };

  const closeDeleteDialog = (): void => {
    if (deleting) {
      return;
    }
    const connectionId = pendingDeleteId;
    setPendingDeleteId(null);
    setDialogError(null);
    restoreDeleteTriggerFocus(connectionId);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) {
      return;
    }
    if (!onDeleteConnection) {
      setPendingDeleteId(null);
      return;
    }

    setDeleting(true);
    setDialogError(null);
    try {
      await onDeleteConnection(pendingDelete.id);
      setPendingDeleteId(null);
      setNotice(`Deleted the ${pendingDelete.name} connection.`);
      window.requestAnimationFrame(() => connectionsPanelRef.current?.focus());
    } catch (cause) {
      setDialogError(describeSafeError(cause));
    } finally {
      setDeleting(false);
    }
  };

  const promptCount = state.document.prompts.filter(
    (prompt) => prompt.workspaceId === state.activeWorkspace.id,
  ).length;

  return (
    <div className="settings-view">
      <div className="view-intro">
        <p className="section-kicker">Settings</p>
        <h1>Calm, local, and in your control.</h1>
        <p>
          Appearance, your default model connection, and workspace transfers. Forgeboard
          stores everything on this device and only reaches the network when you run a
          prompt.
        </p>
      </div>

      <div className="data-ledger settings-ledger">
        <div>
          <span className="ledger-value">{state.document.workspaces.length}</span>
          <span className="ledger-label">Workspaces</span>
        </div>
        <div>
          <span className="ledger-value">{promptCount}</span>
          <span className="ledger-label">Prompts here</span>
        </div>
        <div>
          <span className="ledger-value">{connections.length}</span>
          <span className="ledger-label">Connections</span>
        </div>
        <div>
          <span className="ledger-value">{state.document.requests.length}</span>
          <span className="ledger-label">Retained runs</span>
        </div>
      </div>

      {/* Status and errors sit above the panels so the result of an action is
          visible without scrolling past a long settings page. */}
      <p className="settings-status" role="status" aria-live="polite">
        {notice}
      </p>
      {error ? (
        <p className="transfer-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings-grid">
        <section
          aria-labelledby={appearanceTitleId}
          className="settings-panel"
        >
          <div className="settings-panel-heading">
            <div>
              <p className="section-kicker">Appearance</p>
              <h2 id={appearanceTitleId}>Color theme</h2>
            </div>
          </div>
          <p className="settings-panel-copy">
            System follows your desktop setting. Light and dark are stored with the rest of
            this workspace.
          </p>
          <div
            aria-labelledby={appearanceTitleId}
            className="theme-option-grid"
            role="group"
          >
            {themeOptions.map((option) => {
              const isActive = settings.theme === option.value;
              return (
                <button
                  aria-label={`Theme: ${option.label}`}
                  aria-pressed={isActive}
                  className={`theme-option ${isActive ? "is-active" : ""}`.trim()}
                  key={option.value}
                  type="button"
                  onClick={() => handleThemeSelect(option.value)}
                >
                  <Icon name={option.icon} size={16} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          aria-labelledby={connectionTitleId}
          className="settings-panel"
          ref={connectionsPanelRef}
          tabIndex={-1}
        >
          <div className="settings-panel-heading">
            <div>
              <p className="section-kicker">Model connections</p>
              <h2 id={connectionTitleId}>Default connection</h2>
            </div>
            {onCreateConnection ? (
              <button
                className="button button-primary"
                type="button"
                onClick={onCreateConnection}
              >
                <Icon name="plus" size={15} />
                <span>Add connection</span>
              </button>
            ) : null}
          </div>

          <div className="field-group">
            <label htmlFor="settings-default-connection">Default model connection</label>
            <select
              disabled={connections.length === 0}
              id="settings-default-connection"
              onChange={(event) => handleDefaultConnectionChange(event.target.value)}
              value={settings.defaultConnectionId ?? ""}
            >
              {/* The bridge only accepts a known connection ID, so the empty
                  choice is a placeholder and clearing happens by deletion. */}
              <option disabled value="">
                No default connection
              </option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} · {providerLabel(connection)} · {connection.model}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {connections.length === 0
                ? "Add a local Ollama or OpenAI-compatible connection to run prompts."
                : "Runs start with this connection. You can still pick another one in the run panel, and deleting a connection clears the default."}
            </p>
          </div>

          <ul className="connection-list">
            {connections.length === 0 ? (
              <li className="connection-list-empty">
                No saved connections yet. Ollama works locally with no credential.
              </li>
            ) : (
              connections.map((connection) => (
                <li className="connection-list-item" key={connection.id}>
                  <div className="connection-list-copy">
                    <p className="connection-list-name">
                      {connection.name}
                      {connection.id === settings.defaultConnectionId ? (
                        <span className="connection-list-badge">Default</span>
                      ) : null}
                    </p>
                    <p className="connection-list-meta">
                      {providerLabel(connection)} · {connection.model} · {connection.baseUrl}
                    </p>
                    <p className="connection-list-meta">
                      {connection.hasCredential ? "Credential saved securely" : "No credential"}
                      {state.credentialsAvailable
                        ? ""
                        : " · secure storage is unavailable, so a credential lasts this session only"}
                    </p>
                  </div>
                  <div className="connection-list-actions">
                    {onEditConnection ? (
                      <button
                        aria-label={`Edit connection ${connection.name}`}
                        className="text-button"
                        type="button"
                        onClick={() => onEditConnection(connection)}
                      >
                        <Icon name="settings" size={13} />
                        <span>Edit</span>
                      </button>
                    ) : null}
                    {onDeleteConnection ? (
                      <button
                        aria-label={`Delete connection ${connection.name}`}
                        className="text-button text-button-danger"
                        onClick={() => {
                          setDialogError(null);
                          setPendingDeleteId(connection.id);
                        }}
                        ref={(element) => {
                          if (element) {
                            deleteButtonRefs.current.set(connection.id, element);
                          } else {
                            deleteButtonRefs.current.delete(connection.id);
                          }
                        }}
                        type="button"
                      >
                        <Icon name="x" size={13} />
                        <span>Delete</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <ImportExportControls
          onExportPrompt={onExportPrompt}
          onExportWorkspace={onExportWorkspace}
          onImportJson={onImportJson}
          onImportMarkdown={onImportMarkdown}
        />

        <section aria-labelledby={privacyTitleId} className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <p className="section-kicker">Privacy and security</p>
              <h2 id={privacyTitleId}>What leaves this device</h2>
            </div>
          </div>
          <p className="settings-panel-copy">
            Forgeboard is local-first. There is no account, no telemetry, and no cloud
            sync, and prompt contents are never executed as commands.
          </p>
          <ul className="privacy-list">
            <li>
              Workspaces, prompts, settings, and run history are written to this device's
              application data folder.
            </li>
            <li>
              {state.credentialsAvailable
                ? "Model credentials are stored in the operating system's secure credential store."
                : "Secure credential storage is unavailable, so a credential is kept in memory for this session only."}{" "}
              Credential values are never shown in the interface, history, logs, or exports —
              only whether one is saved.
            </li>
            <li>
              A network request happens only when you run a prompt, and it goes to the
              connection you choose. The destination provider is always named in the run
              panel.
            </li>
            <li>
              A workspace export contains your prompts, connections, and retained runs.
              Store it somewhere you trust, and re-enter credentials after an import.
            </li>
          </ul>
        </section>
      </div>

      {pendingDelete ? (
        <div className="workspace-dialog-backdrop">
          <section
            aria-describedby={deleteDescriptionId}
            aria-labelledby={deleteTitleId}
            aria-modal="true"
            className="workspace-dialog"
            role="dialog"
          >
            <div className="dialog-icon dialog-icon-danger" aria-hidden="true">
              <Icon name="x" size={19} />
            </div>
            <h2 id={deleteTitleId}>Delete this connection?</h2>
            <p id={deleteDescriptionId}>
              This removes <strong>{pendingDelete.name}</strong> from Forgeboard and erases its
              stored credential.
              {retainedRuns > 0
                ? ` ${retainedRuns} ${retainedRuns === 1 ? "run keeps" : "runs keep"} its response for reference.`
                : " It has no retained runs."}{" "}
              This action cannot be undone.
            </p>
            {dialogError ? (
              <p className="dialog-error" role="alert">
                {dialogError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="button button-quiet"
                disabled={deleting}
                type="button"
                onClick={closeDeleteDialog}
              >
                Cancel
              </button>
              <button
                className="button button-danger"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                ref={confirmDeleteRef}
                type="button"
              >
                <Icon name="x" size={15} />
                <span>{deleting ? "Deleting…" : "Delete connection"}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
