import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
  icon = "spark",
  children,
  className = "",
}: EmptyStateProps) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className={`empty-state ${className}`.trim()}
      role="region"
    >
      <div className="empty-state-mark" aria-hidden="true">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty-state-copy">
        {eyebrow ? <p className="section-kicker">{eyebrow}</p> : null}
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
        {children}
        {actionLabel ? (
          <button className="button button-primary" type="button" onClick={onAction}>
            <Icon name="plus" size={16} />
            <span>{actionLabel}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
