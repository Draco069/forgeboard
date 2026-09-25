import { useMemo, useState } from "react";
import { extractVariables, renderPrompt } from "../../shared/prompt";
import { normalizeAppError } from "../../shared/errors";
import type {
  AppError,
  Connection,
  Prompt,
  RunRequestInput,
} from "../../shared/types";
import type { LiveRun } from "../state";
import { ErrorNotice } from "./ErrorNotice";
import { Icon } from "./Icon";
import { VariableFields } from "./VariableFields";

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

export interface RunPanelProps {
  connections?: Connection[];
  selectedConnectionId?: string;
  selectedConnection?: Connection | null;
  onConnectionChange?: (connectionId: string) => void;
  onCreateConnection?: () => void;
  onEditConnection?: (connection: Connection) => void;
  prompt?: Prompt | null;
  promptId?: string;
  promptBody?: string;
  renderedPrompt?: string;
  variables?: string[];
  variableValues?: Record<string, string>;
  onVariableValuesChange?: (values: Record<string, string>) => void;
  workspaceId?: string;
  onRun: (input: RunRequestInput) => unknown | Promise<unknown>;
  onCancel: (requestId: string) => unknown | Promise<unknown>;
  activeRun?: LiveRun | null;
  isRunning?: boolean;
  error?: AppError | null;
  onRetry?: () => void;
  onDismissError?: () => void;
  showVariableFields?: boolean;
}

function providerLabel(connection: Connection): string {
  return connection.provider === "ollama" ? "Ollama" : "OpenAI-compatible";
}

function validateTimeout(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return null;
  }
  return parsed;
}

export function RunPanel({
  connections = [],
  selectedConnectionId,
  selectedConnection: selectedConnectionProp,
  onConnectionChange,
  onCreateConnection,
  onEditConnection,
  prompt,
  promptId,
  promptBody,
  renderedPrompt,
  variables: variablesProp,
  variableValues: variableValuesProp,
  onVariableValuesChange,
  workspaceId,
  onRun,
  onCancel,
  activeRun = null,
  isRunning = false,
  error,
  onRetry,
  onDismissError,
  showVariableFields = true,
}: RunPanelProps) {
  const [internalValues, setInternalValues] = useState<Record<string, string>>({});
  const [timeoutText, setTimeoutText] = useState(String(DEFAULT_TIMEOUT_MS));
  const [localValidation, setLocalValidation] = useState<string | null>(null);
  const [localError, setLocalError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const body = promptBody ?? prompt?.body ?? renderedPrompt ?? "";
  const variables = useMemo(
    () => variablesProp ?? extractVariables(body),
    [body, variablesProp],
  );
  const values = variableValuesProp ?? internalValues;
  const selectedConnection =
    selectedConnectionProp ??
    (selectedConnectionId
      ? connections.find((connection) => connection.id === selectedConnectionId)
      : connections[0]) ??
    null;
  const effectivePromptId = promptId ?? prompt?.id;
  const running = isRunning || activeRun?.status === "running";
  const rendered = renderPrompt(body, values);
  const missingVariables = rendered.missing;
  const timeoutMs = validateTimeout(timeoutText);
  const visibleError = localError ?? error;

  const updateValues = (nextValues: Record<string, string>): void => {
    if (variableValuesProp === undefined) {
      setInternalValues(nextValues);
    }
    onVariableValuesChange?.(nextValues);
    setLocalValidation(null);
    setLocalError(null);
  };

  const handleRun = async (): Promise<void> => {
    if (running || submitting) {
      return;
    }
    if (body.trim().length === 0) {
      setLocalValidation("Add prompt text before running it.");
      return;
    }
    if (!selectedConnection) {
      setLocalValidation("Choose or add a model connection before running this prompt.");
      return;
    }
    if (missingVariables.length > 0) {
      setLocalValidation(`Fill in the required variables: ${missingVariables.join(", ")}.`);
      return;
    }
    if (timeoutMs === null) {
      setLocalValidation("Choose a timeout between 100 and 60,000 milliseconds.");
      return;
    }

    setLocalValidation(null);
    setLocalError(null);
    setSubmitting(true);
    try {
      await onRun({
        ...(workspaceId ? { workspaceId } : {}),
        ...(effectivePromptId ? { promptId: effectivePromptId } : {}),
        connectionId: selectedConnection.id,
        renderedPrompt: rendered.text,
        stream: true,
        timeoutMs,
      });
    } catch (cause) {
      setLocalError(normalizeAppError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    const requestId = activeRun?.requestId;
    if (!requestId || !running) {
      return;
    }
    setLocalError(null);
    try {
      await onCancel(requestId);
    } catch (cause) {
      setLocalError(normalizeAppError(cause));
    }
  };

  return (
    <section className="run-panel" aria-labelledby="run-panel-title">
      <div className="run-panel-heading">
        <div>
          <p className="section-kicker">Model playground</p>
          <h2 id="run-panel-title">Run this prompt</h2>
        </div>
        <span
          aria-label={`Run status: ${running ? "running" : "idle"}`}
          className={`run-panel-status ${running ? "is-running" : ""}`}
          role="status"
        >
          <span className="run-panel-status-dot" aria-hidden="true" />
          {running ? "Running" : "Ready"}
        </span>
      </div>

      <div className="run-panel-grid">
        <div className="field-group">
          <label htmlFor="run-connection">Model connection</label>
          <select
            disabled={running}
            id="run-connection"
            onChange={(event) => onConnectionChange?.(event.target.value)}
            value={selectedConnection?.id ?? ""}
          >
            <option value="">Select a connection…</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name} · {providerLabel(connection)} · {connection.model}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {selectedConnection
              ? `${providerLabel(selectedConnection)} · ${selectedConnection.model} · ${
                  selectedConnection.hasCredential ? "credential saved securely" : "no credential"
                }`
              : "Saved connections stay local to this Forgeboard workspace."}
          </p>
          {onCreateConnection || (selectedConnection && onEditConnection) ? (
            <div className="run-connection-actions">
              {onCreateConnection ? (
                <button className="text-button" disabled={running} type="button" onClick={onCreateConnection}>
                  <Icon name="plus" size={13} />
                  <span>Add connection</span>
                </button>
              ) : null}
              {selectedConnection && onEditConnection ? (
                <button
                  className="text-button"
                  disabled={running}
                  type="button"
                  onClick={() => onEditConnection(selectedConnection)}
                >
                  <Icon name="settings" size={13} />
                  <span>Edit connection</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor="run-timeout">Timeout (milliseconds)</label>
          <input
            aria-describedby="run-timeout-hint"
            disabled={running}
            id="run-timeout"
            inputMode="numeric"
            max={MAX_TIMEOUT_MS}
            min={MIN_TIMEOUT_MS}
            onChange={(event) => setTimeoutText(event.target.value)}
            type="number"
            value={timeoutText}
          />
          <p className="field-hint" id="run-timeout-hint">
            Requests are cancelled automatically after this limit.
          </p>
        </div>
      </div>

      {showVariableFields ? (
        <VariableFields onChange={updateValues} values={values} variables={variables} />
      ) : (
        <div className="run-variable-summary" aria-label="Prompt variable values">
          <p className="field-hint">
            {variables.length === 0
              ? "This prompt has no template variables."
              : `${variables.length} template ${variables.length === 1 ? "variable" : "variables"} are filled in the prompt editor.`}
          </p>
          {variables.length > 0 ? (
            <ul>
              {variables.map((variable) => (
                <li key={variable}>
                  <code>{`{{${variable}}}`}</code>
                  <span>{values[variable]?.trim() ? "Ready" : "Needs a value"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {missingVariables.length > 0 ? (
        <p className="run-validation-message" role="status">
          {showVariableFields
            ? `Fill in the required variables: ${missingVariables.join(", ")}.`
            : "Complete the template fields above before running."}
        </p>
      ) : null}
      {localValidation ? (
        <p className="run-validation-message" role="alert">
          {localValidation}
        </p>
      ) : null}
      {visibleError ? (
        <ErrorNotice
          compact
          error={visibleError}
          onDismiss={onDismissError}
          onRetry={onRetry}
        />
      ) : null}

      <div className="run-panel-actions">
        <button
          className="button button-primary run-submit-button"
          disabled={running || submitting || !selectedConnection || body.trim().length === 0 || missingVariables.length > 0 || timeoutMs === null}
          type="button"
          onClick={() => void handleRun()}
        >
          <Icon name="terminal" size={16} />
          <span>{running || submitting ? "Running…" : "Run prompt"}</span>
        </button>
        {running ? (
          <button
            className="button button-danger"
            disabled={!activeRun?.requestId}
            type="button"
            onClick={() => void handleCancel()}
          >
            <Icon name="x" size={15} />
            <span>Cancel request</span>
          </button>
        ) : null}
        <span className="run-shortcut-note">
          <kbd>Ctrl</kbd><span aria-hidden="true">+</span><kbd>Enter</kbd> to run
        </span>
      </div>
    </section>
  );
}
