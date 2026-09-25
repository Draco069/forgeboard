import { useEffect, useMemo, useState } from "react";
import type { RequestRecord } from "../../shared/types";
import { copyTextToClipboard, formatDuration } from "./ResponseViewer";
import { Icon } from "./Icon";

export interface HistoryGroup {
  key: string;
  label: string;
  requests: RequestRecord[];
}

export interface HistoryListProps {
  requests: RequestRecord[];
  selectedRequestId?: string;
  onSelect?: (request: RequestRecord) => void;
  /** IDs currently selected for comparison. When omitted, selection is local. */
  comparisonIds?: string[];
  onComparisonChange?: (requestIds: string[]) => void;
  onCompare?: (left: RequestRecord, right: RequestRecord) => void;
  onCopy?: (text: string) => Promise<boolean> | boolean;
}

function dateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

export function groupRequestsByDate(requests: RequestRecord[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  const sorted = [...requests].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  for (const request of sorted) {
    const key = dateKey(request.createdAt);
    const existing = groups.get(key);
    if (existing) {
      existing.requests.push(request);
    } else {
      groups.set(key, {
        key,
        label: dateLabel(request.createdAt),
        requests: [request],
      });
    }
  }

  return [...groups.values()];
}

function statusLabel(status: RequestRecord["status"]): string {
  if (status === "success") {
    return "Completed";
  }
  if (status === "error") {
    return "Failed";
  }
  return "Cancelled";
}

function providerLabel(provider: RequestRecord["provider"]): string {
  return provider === "ollama" ? "Ollama" : "OpenAI-compatible";
}

export function HistoryList({
  requests,
  selectedRequestId,
  onSelect,
  comparisonIds,
  onComparisonChange,
  onCompare,
  onCopy,
}: HistoryListProps) {
  const [internalComparisonIds, setInternalComparisonIds] = useState<string[]>([]);
  const [copyMessage, setCopyMessage] = useState("");
  const groups = useMemo(() => groupRequestsByDate(requests), [requests]);
  const selectedIds = comparisonIds ?? internalComparisonIds;

  useEffect(() => {
    const availableIds = new Set(requests.map((request) => request.id));
    const nextIds = selectedIds.filter((id) => availableIds.has(id)).slice(-2);
    if (nextIds.length !== selectedIds.length) {
      if (comparisonIds === undefined) {
        setInternalComparisonIds(nextIds);
      } else {
        onComparisonChange?.(nextIds);
      }
    }
  }, [comparisonIds, onComparisonChange, requests, selectedIds]);

  const compareSelected = (): void => {
    if (selectedIds.length !== 2 || !onCompare) {
      return;
    }
    const left = requests.find((request) => request.id === selectedIds[0]);
    const right = requests.find((request) => request.id === selectedIds[1]);
    if (left && right) {
      onCompare(left, right);
    }
  };

  const toggleComparison = (requestId: string): void => {
    const nextIds = selectedIds.includes(requestId)
      ? selectedIds.filter((id) => id !== requestId)
      : [...selectedIds, requestId].slice(-2);
    if (comparisonIds === undefined) {
      setInternalComparisonIds(nextIds);
    }
    onComparisonChange?.(nextIds);

    if (nextIds.length === 2) {
      const left = requests.find((request) => request.id === nextIds[0]);
      const right = requests.find((request) => request.id === nextIds[1]);
      if (left && right) {
        onCompare?.(left, right);
      }
    }
  };

  const handleCopy = async (request: RequestRecord): Promise<void> => {
    const text = request.response || request.errorMessage || "";
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

  if (groups.length === 0) {
    return (
      <div className="history-list-empty" role="status">
        <Icon name="history" size={20} />
        <p>No runs in this workspace yet.</p>
      </div>
    );
  }

  return (
    <div className="history-list-wrap">
      <div className="history-list-heading">
        <div>
          <p className="section-kicker">Response archive</p>
          <h2>Recent runs</h2>
        </div>
        <p className="history-selection-hint" role="status">
          {selectedIds.length === 2
            ? "Two responses selected. Open the comparison when you’re ready."
            : "Select two responses to compare side by side."}
        </p>
      </div>

      {selectedIds.length === 2 && onCompare ? (
        <div className="history-comparison-actions">
          <button className="button button-secondary" type="button" onClick={compareSelected}>
            <Icon name="layers" size={15} />
            <span>Compare selected</span>
          </button>
        </div>
      ) : null}

      <div className="history-groups">
        {groups.map((group) => (
          <section className="history-day" key={group.key} aria-labelledby={`history-day-${group.key}`}>
            <h3 id={`history-day-${group.key}`}>{group.label}</h3>
            <ul className="history-list">
              {group.requests.map((request) => {
                const isSelected = selectedRequestId === request.id;
                const isComparisonSelected = selectedIds.includes(request.id);
                const response = request.response || request.errorMessage || "No response text.";
                return (
                  <li
                    className={`history-item ${isSelected ? "is-selected" : ""}`.trim()}
                    data-testid={`history-request-${request.id}`}
                    key={request.id}
                  >
                    <div className="history-item-main">
                      <button
                        aria-label={`Open response from ${request.model}`}
                        className="history-open-button"
                        type="button"
                        onClick={() => onSelect?.(request)}
                      >
                        <span className="history-item-title">{request.model}</span>
                        <span className="history-item-meta">
                          {providerLabel(request.provider)} · {formatDuration(request.durationMs)} ·{" "}
                          {new Date(request.createdAt).toLocaleTimeString()}
                        </span>
                      </button>
                      <span className={`history-status history-status-${request.status}`}>
                        {statusLabel(request.status)}
                      </span>
                    </div>
                    <p className="history-item-prompt">{request.renderedPrompt}</p>
                    <div className="history-item-footer">
                      <label className="history-compare-control">
                        <input
                          aria-label={`Select ${request.model} response for comparison`}
                          checked={isComparisonSelected}
                          onChange={() => toggleComparison(request.id)}
                          type="checkbox"
                        />
                        <span>Compare</span>
                      </label>
                      <button
                        aria-label={`Copy response from ${request.model}`}
                        className="text-button history-copy-button"
                        disabled={response === "No response text."}
                        type="button"
                        onClick={() => void handleCopy(request)}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="history-item-response" aria-label={`Response from ${request.model}`}>
                      {response}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <span aria-live="polite" className="copy-status" role="status">
        {copyMessage}
      </span>
    </div>
  );
}
