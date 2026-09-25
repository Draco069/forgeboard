import { useId } from "react";
import { normalizeAppError } from "../../shared/errors";
import type { AppError } from "../../shared/types";
import { Icon } from "./Icon";

export interface ErrorNoticeProps {
  error?: AppError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Additional values that must be removed if a provider included them in detail. */
  secrets?: string[];
  compact?: boolean;
  className?: string;
}

export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  secrets = [],
  compact = false,
  className = "",
}: ErrorNoticeProps) {
  const titleId = useId();
  if (!error) {
    return null;
  }

  // Normalize again at the display boundary. This protects standalone renderer
  // callers from accidentally rendering an Error object or an unredacted detail.
  const safeError = normalizeAppError(error, secrets);
  const detailId = `${titleId}-detail`;

  return (
    <section
      aria-labelledby={titleId}
      className={`error-notice ${compact ? "error-notice-compact" : ""} ${className}`.trim()}
      role="alert"
    >
      <div className="error-notice-icon" aria-hidden="true">
        <Icon name="archive" size={16} />
      </div>
      <div className="error-notice-copy">
        <strong id={titleId}>{safeError.message}</strong>
        {safeError.detail ? (
          <details className="error-notice-details">
            <summary>Show technical details</summary>
            <p id={detailId}>{safeError.detail}</p>
          </details>
        ) : null}
        {safeError.retryable || onDismiss ? (
          <div className="error-notice-actions">
            {safeError.retryable ? (
              <button className="text-button" type="button" onClick={onRetry}>
                Try again
              </button>
            ) : null}
            {onDismiss ? (
              <button className="text-button" type="button" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
