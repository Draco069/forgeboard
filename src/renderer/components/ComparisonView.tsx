import { useEffect, useId, useRef, useState } from "react";
import type { RequestRecord } from "../../shared/types";
import { copyTextToClipboard, formatDuration } from "./ResponseViewer";
import { Icon } from "./Icon";

export interface ComparisonViewProps {
  left: RequestRecord;
  right: RequestRecord;
  onClose?: () => void;
  onCopy?: (text: string) => Promise<boolean> | boolean;
}

function providerLabel(provider: RequestRecord["provider"]): string {
  return provider === "ollama" ? "Ollama" : "OpenAI-compatible";
}

export function ComparisonView({ left, right, onClose, onCopy }: ComparisonViewProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
  }, []);

  const closeDialog = (): void => {
    onClose?.();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCopy = async (record: RequestRecord): Promise<void> => {
    const text = record.response || record.errorMessage || "";
    if (text.length === 0) {
      setCopyMessage("There is no response to copy.");
      return;
    }
    try {
      const copied = onCopy ? await onCopy(text) : await copyTextToClipboard(text);
      setCopyMessage(copied ? "Response copied." : "Copy was unavailable. Select the response text to copy it manually.");
    } catch {
      setCopyMessage("Copy was unavailable. Select the response text to copy it manually.");
    }
  };

  const renderColumn = (record: RequestRecord, label: string, side: "left" | "right") => {
    const response = record.response || record.errorMessage || "No response text.";
    return (
      <article className={`comparison-column comparison-column-${side}`} key={record.id}>
        <div className="comparison-column-heading">
          <div>
            <p className="section-kicker">{label}</p>
            <h3>{record.model}</h3>
          </div>
          <span className={`history-status history-status-${record.status}`}>
            {record.status === "success" ? "Completed" : record.status === "error" ? "Failed" : "Cancelled"}
          </span>
        </div>
        <p className="comparison-meta">
          {providerLabel(record.provider)} · {formatDuration(record.durationMs)} · {new Date(record.createdAt).toLocaleTimeString()}
        </p>
        <div className="comparison-block">
          <h4>Prompt</h4>
          <pre className="comparison-prompt">{record.renderedPrompt}</pre>
        </div>
        <div className="comparison-block">
          <h4>Response</h4>
          <pre className="comparison-response" aria-label={`${label} response`}>
            {response}
          </pre>
        </div>
        <button
          aria-label={`Copy ${label.toLowerCase()} response`}
          className="button button-secondary comparison-copy-button"
          type="button"
          onClick={() => void handleCopy(record)}
        >
          <Icon name="check" size={15} />
          <span>Copy response</span>
        </button>
      </article>
    );
  };

  return (
    <div className="comparison-backdrop">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="comparison-dialog"
        role="dialog"
      >
        <div className="comparison-dialog-heading">
          <div>
            <p className="section-kicker">Response comparison</p>
            <h2 id={titleId}>Compare two responses</h2>
          </div>
          <button
            aria-label="Close response comparison"
            className="icon-button"
            ref={closeButtonRef}
            title="Close response comparison"
            type="button"
            onClick={closeDialog}
          >
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="comparison-grid">
          {renderColumn(left, "Response A", "left")}
          {renderColumn(right, "Response B", "right")}
        </div>
        <span aria-live="polite" className="copy-status" role="status">
          {copyMessage}
        </span>
      </section>
    </div>
  );
}
