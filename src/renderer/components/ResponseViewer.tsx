import { useEffect, useId, useState } from "react";
import type { AppError, RequestRecord } from "../../shared/types";
import { ErrorNotice } from "./ErrorNotice";
import { Icon } from "./Icon";

export type ResponseViewerStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ResponseViewerProps {
  record?: RequestRecord | null;
  liveText?: string | null;
  status?: ResponseViewerStatus;
  error?: AppError | null;
  onCompare?: (record: RequestRecord) => void;
  onRetry?: () => void;
  onDismissError?: () => void;
  onCopy?: (text: string) => Promise<boolean> | boolean;
  className?: string;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) {
    return false;
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function statusFromRecord(record: RequestRecord | null | undefined): ResponseViewerStatus {
  if (!record) {
    return "queued";
  }
  if (record.status === "success") {
    return "completed";
  }
  if (record.status === "error") {
    return "failed";
  }
  return "cancelled";
}

function statusLabel(status: ResponseViewerStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return "—";
  }
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

export function ResponseViewer({
  record,
  liveText,
  status,
  error,
  onCompare,
  onRetry,
  onDismissError,
  onCopy,
  className = "",
}: ResponseViewerProps) {
  const [copyMessage, setCopyMessage] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const responseText = liveText ?? record?.response ?? "";
  const effectiveStatus = status ?? (record ? statusFromRecord(record) : liveText === undefined ? "queued" : "running");
  const headingId = useId();

  useEffect(() => {
    setCopyMessage("");
    setCopyFailed(false);
  }, [record?.id, responseText]);

  const handleCopy = async (): Promise<void> => {
    if (responseText.length === 0) {
      setCopyFailed(true);
      setCopyMessage("There is no response to copy.");
      return;
    }

    const copied = onCopy ? await onCopy(responseText) : await copyTextToClipboard(responseText);
    if (copied) {
      setCopyFailed(false);
      setCopyMessage("Response copied.");
    } else {
      setCopyFailed(true);
      setCopyMessage("Copy was unavailable. Select the response text to copy it manually.");
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={`response-viewer ${className}`.trim()}
      data-testid="response-viewer"
    >
      <div className="response-viewer-heading">
        <div>
          <p className="section-kicker">Response</p>
          <h2 id={headingId}>Model output</h2>
        </div>
        <span
          aria-label={`Response status: ${statusLabel(effectiveStatus)}`}
          className={`response-status response-status-${effectiveStatus}`}
          data-testid="response-status"
          role="status"
        >
          <span className="response-status-dot" aria-hidden="true" />
          {statusLabel(effectiveStatus)}
        </span>
      </div>

      {record ? (
        <div className="response-metadata" aria-label="Response details">
          <span>{record.provider === "ollama" ? "Ollama" : "OpenAI-compatible"}</span>
          <span aria-hidden="true">·</span>
          <span>{record.model}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDuration(record.durationMs)}</span>
        </div>
      ) : null}

      {record?.renderedPrompt ? (
        <details className="response-prompt-details">
          <summary>Prompt sent to model</summary>
          <pre className="response-prompt-text">{record.renderedPrompt}</pre>
        </details>
      ) : null}

      {error ? (
        <ErrorNotice
          compact
          error={error}
          onDismiss={onDismissError}
          onRetry={onRetry}
        />
      ) : null}

      <div className="response-text-shell">
        {responseText.length > 0 ? (
          <pre aria-label="Response text" className="response-text" data-testid="response-text">
            {responseText}
          </pre>
        ) : (
          <p className="response-empty" role="status">
            {effectiveStatus === "running"
              ? "Waiting for the first response chunk…"
              : effectiveStatus === "queued"
                ? "Ready to run this prompt."
                : "No response text was returned."}
          </p>
        )}
      </div>

      <div className="response-viewer-actions">
        <button
          aria-label="Copy response"
          className="button button-secondary"
          disabled={responseText.length === 0}
          title="Copy response"
          type="button"
          onClick={() => void handleCopy()}
        >
          <Icon name="check" size={15} />
          <span>Copy response</span>
        </button>
        {record && onCompare ? (
          <button
            aria-label="Compare response"
            className="button button-secondary"
            type="button"
            onClick={() => onCompare(record)}
          >
            <Icon name="layers" size={15} />
            <span>Compare</span>
          </button>
        ) : null}
        <span
          aria-live="polite"
          className={`copy-status ${copyFailed ? "is-error" : ""}`.trim()}
          role="status"
        >
          {copyMessage}
        </span>
      </div>
    </section>
  );
}
