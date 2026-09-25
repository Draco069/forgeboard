import { useId, useState, type ChangeEvent } from "react";
import { normalizeAppError } from "../../shared/errors";
import {
  IMPORT_FILE_ACCEPT,
  detectImportFileKind,
  sanitizeDownloadFilename,
} from "../../shared/serialization";
import { MAX_IMPORT_LENGTH } from "../../shared/validation";
import type { ImportCounts, ImportReport } from "../../shared/types";
import { Icon } from "./Icon";

export const JSON_MIME_TYPE = "application/json;charset=utf-8";
export const MARKDOWN_MIME_TYPE = "text/markdown;charset=utf-8";

export interface ImportExportControlsProps {
  /** Produces the workspace snapshot and returns the downloaded file name. */
  onExportWorkspace: () => string | Promise<string>;
  /** Optional because Markdown export needs a selected prompt. */
  onExportPrompt?: (() => string | Promise<string>) | null;
  /** Returns the bridge import report so counts and warnings stay visible. */
  onImportJson: (contents: string) => Promise<ImportReport>;
  /** Returns the title of the prompt that was stored in the active workspace. */
  onImportMarkdown: (contents: string, filename: string) => Promise<string>;
  disabled?: boolean;
  className?: string;
}

/**
 * Triggers a renderer-only download. The bridge returns file contents, never a
 * filesystem path, so the renderer owns the save step and the file name is
 * reduced to a single safe name.
 */
export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType: string,
): string {
  const safeName = sanitizeDownloadFilename(filename);
  const anchor = document.createElement("a");
  const canUseBlobUrl =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

  anchor.download = safeName;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  // Test and hardened environments without Blob URLs still get a plain name.
  anchor.href = canUseBlobUrl
    ? URL.createObjectURL(new Blob([contents], { type: mimeType }))
    : `data:${mimeType},${encodeURIComponent(contents)}`;

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (canUseBlobUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(anchor.href);
  }
  return safeName;
}

function describeTransferError(cause: unknown): string {
  const error = normalizeAppError(cause);
  return error.detail ? `${error.message} ${error.detail}` : error.message;
}

function describeCounts(counts: ImportCounts): string {
  const parts = [
    `${counts.workspaces} ${counts.workspaces === 1 ? "workspace" : "workspaces"}`,
    `${counts.prompts} ${counts.prompts === 1 ? "prompt" : "prompts"}`,
    `${counts.connections} ${counts.connections === 1 ? "connection" : "connections"}`,
    `${counts.requests} ${counts.requests === 1 ? "run" : "runs"}`,
  ];
  return parts.join(", ");
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(new Error("The selected file could not be read.")),
    );
    reader.readAsText(file);
  });
}

export function ImportExportControls({
  onExportWorkspace,
  onExportPrompt,
  onImportJson,
  onImportMarkdown,
  disabled = false,
  className = "",
}: ImportExportControlsProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const fileId = useId();
  const fileHintId = useId();
  const promptExportHintId = useId();
  const blocked = disabled || busy;
  const promptExport = typeof onExportPrompt === "function" ? onExportPrompt : null;

  const resetFeedback = (): void => {
    setError(null);
    setReport(null);
  };

  const runTransfer = async (
    successMessage: (filename: string) => string,
    action: () => string | Promise<string>,
  ): Promise<void> => {
    setBusy(true);
    resetFeedback();
    try {
      const filename = await action();
      setStatus(successMessage(filename));
    } catch (cause) {
      setError(describeTransferError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleExportWorkspace = (): void => {
    void runTransfer(
      (filename) => `Exported the workspace snapshot to ${filename}.`,
      onExportWorkspace,
    );
  };

  const handleExportPrompt = (): void => {
    if (!promptExport) {
      return;
    }
    void runTransfer(
      (filename) => `Exported the selected prompt to ${filename}.`,
      promptExport,
    );
  };

  const importFile = async (file: File): Promise<void> => {
    const kind = detectImportFileKind(file.name);
    if (!kind) {
      resetFeedback();
      setError("Choose a Forgeboard .json workspace export or a .md prompt file.");
      return;
    }
    if (file.size > MAX_IMPORT_LENGTH) {
      resetFeedback();
      setError("That file is too large to import. Keep workspace imports under 10 MB.");
      return;
    }

    setBusy(true);
    resetFeedback();
    try {
      const contents = await readFileText(file);
      if (kind === "json") {
        const nextReport = await onImportJson(contents);
        setReport(nextReport);
        setStatus(`Imported ${describeCounts(nextReport.counts)}.`);
        return;
      }
      const title = await onImportMarkdown(contents, file.name);
      setStatus(`Imported the prompt “${title}” into this workspace.`);
    } catch (cause) {
      setError(describeTransferError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.target;
    const file = input.files?.[0];
    try {
      // Reset so picking the same file again runs the import instead of no-op.
      input.value = "";
    } catch {
      // Environments that forbid clearing the picker keep the previous file.
    }
    if (file) {
      void importFile(file);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      className={`settings-panel import-export-panel ${className}`.trim()}
    >
      <div className="settings-panel-heading">
        <div>
          <p className="section-kicker">Import and export</p>
          <h2 id={titleId}>Move your workspace in and out</h2>
        </div>
        <span className="run-panel-status" role="status">
          <span className="run-panel-status-dot" aria-hidden="true" />
          {busy ? "Working" : "Ready"}
        </span>
      </div>
      <p className="settings-panel-copy">
        Exports stay on this device until you choose where to save them. A JSON export
        carries every workspace, prompt, connection, and retained run — never a credential
        value. Markdown imports add one prompt to the active workspace.
      </p>

      <div className="transfer-actions">
        <button
          className="button button-secondary"
          disabled={blocked}
          type="button"
          onClick={handleExportWorkspace}
        >
          <Icon name="archive" size={15} />
          <span>Export workspace JSON</span>
        </button>
        <button
          aria-describedby={promptExportHintId}
          className="button button-secondary"
          disabled={blocked || !promptExport}
          type="button"
          onClick={handleExportPrompt}
        >
          <Icon name="arrow-up-right" size={15} />
          <span>Export selected prompt</span>
        </button>
      </div>
      <p className="field-hint" id={promptExportHintId}>
        {promptExport
          ? "The Markdown file carries the selected prompt with its title, description, tags, and body."
          : "Select a prompt in the library first to export it as Markdown."}
      </p>

      <div className="field-group transfer-file-field">
        <label htmlFor={fileId}>Import file</label>
        <input
          accept={IMPORT_FILE_ACCEPT}
          aria-describedby={fileHintId}
          disabled={blocked}
          id={fileId}
          onChange={(event) => handleFileChange(event)}
          type="file"
        />
        <p className="field-hint" id={fileHintId}>
          Accepts a Forgeboard <code>.json</code> workspace export or a <code>.md</code>{' '}
          prompt file. A rejected file leaves the current workspace untouched.
        </p>
      </div>

      <p className="transfer-status" role="status" aria-live="polite">
        {status}
      </p>
      {error ? (
        <p className="transfer-error" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="transfer-report" data-testid="import-report">
          <p className="transfer-report-summary">Workspace contents were replaced.</p>
          {report.warnings.length > 0 ? (
            <>
              <p className="transfer-report-label">Review these notes</p>
              <ul className="transfer-warnings">
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="field-hint">No recovery warnings were reported.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
