import type { AppPing, Theme } from "../../shared/types";
import type { RendererState } from "../state";
import { Icon, type IconName } from "./Icon";

export interface TopbarProps {
  state: RendererState;
  onThemeChange?: (theme: Theme) => void;
  onRefresh?: () => void;
  onCreatePrompt?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  bridgePing?: AppPing | null;
  bridgeUnavailable?: boolean;
}

const themeOptions: Array<{ value: Theme; label: string; icon: IconName }> = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

function bridgeMessage(
  bridgePing: AppPing | null | undefined,
  bridgeUnavailable: boolean | undefined,
): string {
  if (bridgePing) {
    return `Ready · version ${bridgePing.version}`;
  }
  if (bridgeUnavailable) {
    return "The local bridge is unavailable.";
  }
  return "Checking the local bridge…";
}

export function Topbar({
  state,
  onThemeChange,
  onRefresh,
  onCreatePrompt,
  refreshing = false,
  loading = false,
  bridgePing,
  bridgeUnavailable = false,
}: TopbarProps) {
  const activeRun = state.activeRun;
  const runStatus = activeRun?.status ?? "idle";
  const runLabel =
    runStatus === "running"
      ? `Live run · ${activeRun?.model ?? "model"}`
      : runStatus === "success"
        ? "Last run complete"
        : runStatus === "error"
          ? "Last run needs attention"
          : runStatus === "cancelled"
            ? "Last run cancelled"
            : "No active run";

  return (
    <header className="topbar">
      <div className="topbar-context">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumb-list">
            <li>
              <span className="breadcrumb-muted">Workspace</span>
            </li>
            <li aria-current="page">
              <span>{state.activeWorkspace.name}</span>
            </li>
          </ol>
        </nav>
        <p className="topbar-status" role="status" aria-live="polite">
          <span className={`status-pip status-pip-${runStatus}`} aria-hidden="true" />
          <span>{runLabel}</span>
          {!loading ? (
            <>
              <span className="status-divider" aria-hidden="true">
                /
              </span>
              <span>{bridgeMessage(bridgePing, bridgeUnavailable)}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="topbar-actions">
        <div className="theme-switcher" aria-label="Color theme" role="group">
          {themeOptions.map((option) => {
            const isActive = state.theme === option.value;
            return (
              <button
                aria-label={`${option.label} theme`}
                aria-pressed={isActive}
                className={`theme-button ${isActive ? "is-active" : ""}`.trim()}
                key={option.value}
                title={`Use ${option.label.toLowerCase()} theme`}
                type="button"
                onClick={() => onThemeChange?.(option.value)}
              >
                <Icon name={option.icon} size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <span className="topbar-action-divider" aria-hidden="true" />
        <button
          aria-label="Refresh workspace"
          className="icon-button"
          disabled={refreshing}
          title="Refresh workspace"
          type="button"
          onClick={onRefresh}
        >
          <Icon name="refresh" size={17} />
        </button>
        <button
          aria-label="Create a new prompt"
          className="button button-primary topbar-create-button"
          title="Create a new prompt"
          type="button"
          onClick={onCreatePrompt}
        >
          <Icon name="plus" size={16} />
          <span>New prompt</span>
        </button>
      </div>
    </header>
  );
}
