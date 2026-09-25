import type { ReactNode } from "react";
import type { AppPing, Theme } from "../../shared/types";
import type { ForgeboardView, RendererState } from "../state";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface AppShellProps {
  children: ReactNode;
  state: RendererState;
  onViewChange?: (view: ForgeboardView) => void;
  onNavigate?: (view: ForgeboardView) => void;
  onWorkspaceChange?: (workspaceId: string) => void;
  onThemeChange?: (theme: Theme) => void;
  onRefresh?: () => void;
  onCreatePrompt?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  bridgePing?: AppPing | null;
  bridgeUnavailable?: boolean;
  initializationError?: ReactNode;
}

export function AppShell({
  children,
  state,
  onViewChange,
  onNavigate,
  onWorkspaceChange,
  onThemeChange,
  onRefresh,
  onCreatePrompt,
  refreshing = false,
  loading = false,
  bridgePing,
  bridgeUnavailable = false,
  initializationError,
}: AppShellProps) {
  const handleViewChange = onViewChange ?? onNavigate ?? (() => undefined);

  return (
    <div
      aria-busy={loading || refreshing}
      className="app-frame"
      data-testid="app-shell"
    >
      <Sidebar
        onCreatePrompt={onCreatePrompt}
        onViewChange={handleViewChange}
        onWorkspaceChange={onWorkspaceChange}
        state={state}
      />
      <div className="app-workspace">
        <Topbar
          bridgePing={bridgePing}
          bridgeUnavailable={bridgeUnavailable}
          onCreatePrompt={onCreatePrompt}
          onRefresh={onRefresh}
          onThemeChange={onThemeChange}
          loading={loading}
          refreshing={refreshing}
          state={state}
        />
        <main className="workspace-main" id="workspace-main" tabIndex={-1}>
          {initializationError ? (
            <div className="shell-alert" role="alert">
              {initializationError}
            </div>
          ) : null}
          {state.recoveryNotice ? (
            <div className="recovery-notice" role="status">
              <span className="notice-mark" aria-hidden="true">
                !
              </span>
              <div>
                <strong>Recovered your workspace</strong>
                <p>{state.recoveryNotice}</p>
              </div>
            </div>
          ) : null}
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Forgeboard keeps your prompts on this device.</span>
          <span className="footer-version">v0.1 · local-first</span>
        </footer>
      </div>
    </div>
  );
}
